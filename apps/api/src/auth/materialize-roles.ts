import type { BlueprintRoleDef, DepartmentTypeDef } from "@purnit/manifest-schema";
import { Prisma } from "../generated/prisma/client";
import type { PrismaClient, Role } from "../generated/prisma/client";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";
import { resolveBlueprintRoles } from "../rbac/grant-resolution";

/**
 * Ensures a tenant's materialized `Role` rows exactly match a blueprint's
 * role definitions — the one place `extends`-chain resolution
 * (`resolveBlueprintRoles`) actually touches the database. Used both by
 * `AuthService.signup` (a brand-new, empty tenant — every role gets
 * created) and `seed.ts`'s existing-tenant re-sync (missing roles get
 * created, existing ones get their `label`/`permissions`/`extendsRoleId`
 * refreshed) — the exact same code path, so the two can never drift apart.
 *
 * `rank` is deliberately NOT in the update branch's `data` — it's set once
 * from the blueprint def when a role is first created, then left alone on
 * every subsequent reseed, so a Company Admin's own manual reordering
 * (`role.reorder`) survives every future `pnpm run prisma:seed`. Do not add
 * it there by analogy with label/permissions/extendsRoleId.
 *
 * Relies on `resolveBlueprintRoles`'s dependency ordering: a role's parent
 * is always processed (and so already present in `byBlueprintId`) before
 * the role itself.
 */
export async function materializeBlueprintRoles(
  tx: PrismaTx | PrismaClient,
  tenantId: string,
  blueprintRoles: readonly BlueprintRoleDef[],
): Promise<Map<string, Role>> {
  const resolved = resolveBlueprintRoles(blueprintRoles);
  const defById = new Map(blueprintRoles.map((r) => [r.id, r]));

  const existing = await tx.role.findMany({
    where: { tenantId, sourceBlueprintRoleId: { in: resolved.map((r) => r.id) } },
  });
  const existingByBlueprintId = new Map(existing.map((r) => [r.sourceBlueprintRoleId!, r]));

  const byBlueprintId = new Map<string, Role>();
  let fallbackRank = 0;
  for (const { id, permissions } of resolved) {
    const def = defById.get(id)!;
    const parent = def.extends ? byBlueprintId.get(def.extends) : undefined;
    const already = existingByBlueprintId.get(id);

    const role = already
      ? await tx.role.update({
          where: { id: already.id },
          data: { label: def.label, permissions, extendsRoleId: parent?.id ?? null },
        })
      : await tx.role.create({
          data: {
            tenantId,
            label: def.label,
            sourceBlueprintRoleId: id,
            extendsRoleId: parent?.id ?? null,
            permissions,
            rank: def.rank ?? fallbackRank,
          },
        });

    byBlueprintId.set(id, role);
    fallbackRank++;
  }
  return byBlueprintId;
}

/**
 * Ensures a tenant's `DepartmentTypeRoleLabel` rows exactly match a
 * blueprint's `departmentTypes` — the department-type ↔ tier label/override
 * lookup `usersListDataSource` reads at request time (ORG_HIERARCHY.md §3-4).
 * Same full-overwrite-safe re-sync as `materializeBlueprintRoles` (no
 * per-tenant customization mechanism for this yet), same two call sites
 * (`AuthService.signup`, `seed.ts`'s reseed loop). `roleIds` should be the
 * already-materialized `Map` `materializeBlueprintRoles` returns for this
 * same tenant, so `overrideRoleId` can resolve a real DB id rather than a
 * blueprint string id.
 *
 * ⚠️ A real bug lived here initially: one `upsert()` per (departmentType,
 * tier) pair — 47 for the reference taxonomy — issued sequentially. Fine
 * against a plain `PrismaClient` (seed.ts's reseed loop), but fatal inside
 * `AuthService.signup`'s single interactive transaction: 47 sequential
 * network round-trips blew past Prisma's 5s default transaction timeout
 * (`P2028`), 500ing every signup. Fixed with one batched multi-row
 * `INSERT ... ON CONFLICT DO UPDATE` instead of N round-trips — not a
 * `Promise.all` (unsafe against a shared `tx`, see rbac/role-hierarchy.ts's
 * comment), a single query.
 */
export async function materializeDepartmentTypeLabels(
  tx: PrismaTx | PrismaClient,
  tenantId: string,
  departmentTypes: readonly DepartmentTypeDef[],
  roleIds: Map<string, Role>,
): Promise<void> {
  const rows = departmentTypes.flatMap((dt) =>
    Object.entries(dt.tierLabels).map(([sourceBlueprintRoleId, label]) => {
      const overrideRoleId = dt.roleOverrides?.[sourceBlueprintRoleId] ? (roleIds.get(dt.roleOverrides[sourceBlueprintRoleId])?.id ?? null) : null;
      return Prisma.sql`(${tenantId}::uuid, ${dt.id}, ${sourceBlueprintRoleId}, ${label}, ${overrideRoleId}::uuid)`;
    }),
  );
  if (rows.length === 0) return;

  await tx.$executeRaw`
    INSERT INTO department_type_role_labels (tenant_id, department_type, source_blueprint_role_id, label, override_role_id)
    VALUES ${Prisma.join(rows)}
    ON CONFLICT (tenant_id, department_type, source_blueprint_role_id)
    DO UPDATE SET label = EXCLUDED.label, override_role_id = EXCLUDED.override_role_id
  `;
}
