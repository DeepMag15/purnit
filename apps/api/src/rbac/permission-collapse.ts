import { createHash } from "node:crypto";
import { parsePermissionString, type Scope } from "@purnit/manifest-schema";
import { broaderScope } from "./scope";

export interface EffectivePermissions {
  readonly permissionsHash: string;
  has(resource: string, action: string): Scope | null;
  toArray(): string[];
}

function permissionKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}

/**
 * Unions a flat list of "resource:action:scope" grants (already-resolved
 * Role.permissions, potentially from several role assignments) and collapses
 * to the broadest granted scope per resource:action — per ARCHITECTURE.md
 * §5.3's `resolveEffectivePermissions`.
 */
export function collapsePermissions(grants: readonly string[]): EffectivePermissions {
  const byKey = new Map<string, Scope>();
  for (const raw of grants) {
    const { resource, action, scope } = parsePermissionString(raw);
    const key = permissionKey(resource, action);
    const existing = byKey.get(key);
    byKey.set(key, existing ? broaderScope(existing, scope) : scope);
  }

  // Sorted so the hash is stable regardless of grant/role-assignment order.
  const flat = [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, scope]) => `${key}:${scope}`);
  const permissionsHash = createHash("sha256").update(flat.join(",")).digest("hex").slice(0, 32);

  return {
    permissionsHash,
    has(resource, action) {
      return byKey.get(permissionKey(resource, action)) ?? null;
    },
    toArray() {
      return flat;
    },
  };
}
