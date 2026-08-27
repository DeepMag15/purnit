import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

// `roles.list` stays tenant-wide, unscoped — the role catalog itself isn't
// something "own" narrows. `users.list` gained real own-scope narrowing
// (below) once Department Head's `user:manage:own` made "only see my own
// department's roster" meaningful — before that, `user:manage` only ever
// existed at :tenant, so there was nothing to narrow.

const ListUsersParamsSchema = z.object({});

export const usersListDataSource: DataSourceDefinition<z.infer<typeof ListUsersParamsSchema>> = {
  name: "users.list",
  paramsSchema: ListUsersParamsSchema,
  requiredPermission: "user:manage",
  async resolve(_params, ctx, tx) {
    // Department Head's "own" scope means "only my own department's
    // roster" — everyone else (:tenant) sees the full company.
    const scope = ctx.effective.has("user", "manage");
    const where = scope === "own" ? { tenantId: ctx.tenantId, deletedAt: null, departmentId: ctx.userDepartmentId } : { tenantId: ctx.tenantId, deletedAt: null };
    const users = await tx.user.findMany({ where, orderBy: { createdAt: "asc" } });
    // Sequential, not `Promise.all` — concurrent queries against the same
    // transactional `tx` are unsafe (one reserved connection per
    // transaction); see the comment in rbac/role-hierarchy.ts for the real
    // bug this caused elsewhere.
    const assignments = await tx.roleAssignment.findMany({ where: { tenantId: ctx.tenantId, userId: { in: users.map((u) => u.id) } }, include: { role: true } });
    const departments = await tx.department.findMany({ where: { tenantId: ctx.tenantId } });
    const teams = await tx.team.findMany({ where: { tenantId: ctx.tenantId } });
    // Department-type ↔ tier label overlay (ORG_HIERARCHY.md §3-4) — e.g.
    // "Manager" reads as "Engineering Manager" for a user in an
    // Engineering-typed department. Fetched tenant-wide once; most tiers in
    // most departments have no override row at all, which is the expected
    // common case (fall back to the role's own generic label below).
    const typeLabels = await tx.departmentTypeRoleLabel.findMany({ where: { tenantId: ctx.tenantId } });
    const labelByTypeAndRole = new Map(typeLabels.map((l) => [`${l.departmentType}:${l.sourceBlueprintRoleId}`, { label: l.label, overrideRoleId: l.overrideRoleId }]));
    const departmentTypeById = new Map(departments.map((d) => [d.id, d.type]));
    const departmentIdByUserId = new Map(users.map((u) => [u.id, u.departmentId]));

    const roleLabelsByUserId = new Map<string, string[]>();
    const roleIdsByUserId = new Map<string, string[]>();
    for (const a of assignments) {
      const userDepartmentId = departmentIdByUserId.get(a.userId);
      const userDepartmentType = userDepartmentId ? departmentTypeById.get(userDepartmentId) : null;
      const typeLabel = userDepartmentType && a.role.sourceBlueprintRoleId ? labelByTypeAndRole.get(`${userDepartmentType}:${a.role.sourceBlueprintRoleId}`) : undefined;
      // Where a department type's bonus permissions live on a *distinct*
      // role (e.g. HR's Manager tier -> role.hr-manager), only show that
      // flavored label if the user actually holds that exact role — not
      // just anyone at the generic tier sitting in an HR-typed department.
      // Otherwise the label would claim permissions ("HR Manager") the user
      // doesn't actually have. Tiers with no override (the common case) get
      // the cosmetic overlay unconditionally — there's no permission
      // mismatch risk since it's a label-only difference.
      const overlay = typeLabel && (!typeLabel.overrideRoleId || typeLabel.overrideRoleId === a.roleId) ? typeLabel.label : undefined;
      const labels = roleLabelsByUserId.get(a.userId) ?? [];
      labels.push(overlay ?? a.role.label);
      roleLabelsByUserId.set(a.userId, labels);
      const ids = roleIdsByUserId.get(a.userId) ?? [];
      ids.push(a.roleId);
      roleIdsByUserId.set(a.userId, ids);
    }
    const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      roles: roleLabelsByUserId.get(u.id) ?? [],
      // Backs `TeamMembers`' role-change picker — needs the id to pre-select
      // and submit, not just the display label `roles` already carries.
      roleIds: roleIdsByUserId.get(u.id) ?? [],
      departmentId: u.departmentId,
      departmentName: u.departmentId ? (departmentNameById.get(u.departmentId) ?? null) : null,
      teamId: u.teamId,
      teamName: u.teamId ? (teamNameById.get(u.teamId) ?? null) : null,
      jobTitle: u.jobTitle,
      employmentStatus: u.employmentStatus,
      managerId: u.managerId,
    }));
  },
};

const ListRolesParamsSchema = z.object({});

export const rolesListDataSource: DataSourceDefinition<z.infer<typeof ListRolesParamsSchema>> = {
  name: "roles.list",
  paramsSchema: ListRolesParamsSchema,
  requiredPermission: "user:manage",
  async resolve(_params, ctx, tx) {
    const roles = await tx.role.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { rank: "asc" } });
    return roles.map((r) => ({ id: r.id, label: r.label }));
  },
};
