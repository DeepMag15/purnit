import type { BlueprintRoleDef } from "@antigravity/manifest-schema";

/**
 * Resolves a role's final flat permission set from a base (inherited/parent)
 * grant list plus its own deltas. A delta is either a plain grant (added as-is)
 * or prefixed: "+x:y:z" adds it, "-x:y:z" removes an exact matching grant
 * inherited from the base set (see ARCHITECTURE.md §5.2/§6.3's
 * `role.charge-nurse extends role.nurse` example).
 *
 * This runs at role *materialization* time (blueprint seeding today; Stage 4's
 * tenant-config override-applier for custom roles later) — never at permission
 * *check* time, where `Role.permissions` is already the fully resolved flat
 * list (see CONTEXT.md §9/§10 — roles are materialized, not live-looked-up).
 */
export function applyGrantDeltas(baseGrants: readonly string[], deltas: readonly string[]): string[] {
  const result = new Set(baseGrants);
  for (const delta of deltas) {
    if (delta.startsWith("+")) {
      result.add(delta.slice(1));
    } else if (delta.startsWith("-")) {
      result.delete(delta.slice(1));
    } else {
      result.add(delta);
    }
  }
  return [...result];
}

export interface ResolvedBlueprintRole {
  id: string;
  permissions: string[];
}

/**
 * Resolves every role in a blueprint's `extends` chains into a flat
 * permission list, via `applyGrantDeltas`. A role with no `extends` keeps its
 * own `permissions` verbatim (identical to every role today); a role with
 * `extends` applies its own `permissions` as deltas on top of its (already
 * resolved) parent's list.
 *
 * Returns roles in dependency order — a role always appears after whatever
 * it extends — so a caller materializing DB rows can create/link them in a
 * single pass (a child's row can always look up its already-created parent's
 * real id). Throws on an `extends` target that doesn't exist in `roles`, or
 * on a circular chain.
 */
export function resolveBlueprintRoles(roles: readonly BlueprintRoleDef[]): ResolvedBlueprintRole[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const resolved = new Map<string, string[]>();
  const visiting = new Set<string>();
  const order: ResolvedBlueprintRole[] = [];

  function resolve(id: string): string[] {
    const already = resolved.get(id);
    if (already) return already;
    if (visiting.has(id)) throw new Error(`Circular role "extends" chain involving "${id}"`);

    const def = byId.get(id);
    if (!def) throw new Error(`Role "${id}" extends an unknown role`);

    visiting.add(id);
    const permissions = def.extends ? applyGrantDeltas(resolve(def.extends), def.permissions) : [...def.permissions];
    visiting.delete(id);

    resolved.set(id, permissions);
    order.push({ id, permissions });
    return permissions;
  }

  for (const r of roles) resolve(r.id);
  return order;
}
