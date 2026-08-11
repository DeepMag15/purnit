import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { PERMISSION_CATALOG } from "../../rbac/permission-catalog";

const ListRolesDetailedParamsSchema = z.object({});

/** Richer sibling of the existing `roles.list` (users.data-sources.ts) — left
 * completely untouched, since its one real consumer (TeamMembers.tsx's role
 * picker) needs nothing this adds. Two narrow, consumer-shaped data sources
 * rather than one over-fetching shared one, same precedent as
 * `attendance.list`/`attendance.roster`. */
export const rolesListDetailedDataSource: DataSourceDefinition<z.infer<typeof ListRolesDetailedParamsSchema>> = {
  name: "roles.listDetailed",
  paramsSchema: ListRolesDetailedParamsSchema,
  requiredPermission: "role:manage",
  async resolve(_params, ctx, tx) {
    const roles = await tx.role.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { rank: "asc" } });
    const counts = await tx.roleAssignment.groupBy({ by: ["roleId"], where: { tenantId: ctx.tenantId }, _count: { roleId: true } });
    const countByRoleId = new Map(counts.map((c) => [c.roleId, c._count.roleId]));

    return roles.map((r) => ({
      id: r.id,
      label: r.label,
      sourceBlueprintRoleId: r.sourceBlueprintRoleId,
      extendsRoleId: r.extendsRoleId,
      permissions: r.permissions as string[],
      assignmentCount: countByRoleId.get(r.id) ?? 0,
    }));
  },
};

const PermissionsCatalogParamsSchema = z.object({});

export const permissionsCatalogDataSource: DataSourceDefinition<z.infer<typeof PermissionsCatalogParamsSchema>> = {
  name: "permissions.catalog",
  paramsSchema: PermissionsCatalogParamsSchema,
  requiredPermission: "role:manage",
  async resolve() {
    return PERMISSION_CATALOG;
  },
};

const UserEffectivePermissionsParamsSchema = z.object({ userId: z.string() });

/** Lets a `role:manage` holder look up ANY user's resolved effective
 * permissions — distinct from the existing self-only `GET /me/permissions`
 * (me.controller.ts, explicitly documented as "not a permanent API surface
 * consumers should depend on"). Reuses
 * `PermissionResolverService.resolveEffectivePermissionsWithTx` directly,
 * zero new resolution logic. A factory function, not a plain constant —
 * `DataSourceDefinition` is a plain object with no constructor injection
 * point, same reasoning as `createUserInviteMutation`
 * (users.mutations.ts) — the first time that pattern is applied to a data
 * source rather than a mutation. */
export function createUsersEffectivePermissionsDataSource(
  permissionResolver: PermissionResolverService,
): DataSourceDefinition<z.infer<typeof UserEffectivePermissionsParamsSchema>> {
  return {
    name: "users.effectivePermissions",
    paramsSchema: UserEffectivePermissionsParamsSchema,
    requiredPermission: "role:manage",
    async resolve(params, ctx, tx) {
      const user = await tx.user.findFirst({ where: { id: params.userId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!user) throw new NotFoundException(`No user "${params.userId}"`);

      const assignments = await tx.roleAssignment.findMany({ where: { tenantId: ctx.tenantId, userId: params.userId }, include: { role: true } });
      const effective = await permissionResolver.resolveEffectivePermissionsWithTx(tx, ctx.tenantId, params.userId);

      return {
        userId: params.userId,
        permissions: effective.toArray(),
        roles: assignments.map((a) => ({ id: a.role.id, label: a.role.label, sourceBlueprintRoleId: a.role.sourceBlueprintRoleId })),
      };
    },
  };
}
