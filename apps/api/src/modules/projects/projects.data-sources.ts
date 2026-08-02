import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";

/** Applies the granted `project:read` scope to a where-clause. Returns
 * `null` only when there's no read grant at all — department/team scope no
 * longer bails out to `null` just because the user has no department (see
 * below), since "has a task assigned to me in this project" and "I'm a
 * project member" are their own, independent ways to be in scope.
 *
 * ⚠️ "Has a task assigned to me here" and "I'm a member of this project"
 * are always a floor under department/team scope, not something only
 * department match can satisfy — same fix, same reasoning, as
 * `tasksWhere`/`isRowInScope`. Real, user-reported bug: a Member assigned
 * tasks within a project couldn't see that project at all unless it also
 * happened to match their department — which for a Member with no
 * department set (or a project created with no department, as
 * `project.create` does by default) meant the project was *never* visible,
 * even though they had real, permitted work inside it. Fixed by OR-ing "I
 * have an assigned task in this project" and "I'm a member of this
 * project" (`ProjectMember`, the direct Admin-assigns-Members-to-a-project
 * mechanism) alongside the existing department condition. Members have no
 * `project:read:own` grant (they can never own/create a project — see
 * `role.member`'s permissions in `seed.ts`), so these are the *only* paths
 * by which a Member ever sees a project they didn't create, beyond
 * department match. */
export async function projectsWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("project", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "own") {
    where.ownerId = ctx.userId;
    return where;
  }
  if (scope === "tenant") {
    return where;
  }
  const scopeConditions: Record<string, unknown>[] = [
    { tasks: { some: { assigneeId: ctx.userId, deletedAt: null } } },
    { members: { some: { userId: ctx.userId } } },
  ];
  if (scope === "department-subtree") {
    // Resolved only for this branch — see department-subtree.ts.
    if (ctx.userDepartmentId) {
      const subtreeIds = await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId);
      scopeConditions.push({ departmentId: { in: subtreeIds } });
    }
  } else if (ctx.userDepartmentId) {
    // department / team — no teamId column on Project yet, "team" approximates to department (see rbac/scope-check.ts).
    scopeConditions.push({ departmentId: ctx.userDepartmentId });
  }
  where.OR = scopeConditions;
  return where;
}

async function withOwnerNames(tx: PrismaTx, projects: { ownerId: string | null }[]) {
  const ownerIds = [...new Set(projects.map((p) => p.ownerId).filter((id): id is string => !!id))];
  if (ownerIds.length === 0) return new Map<string, string>();
  const owners = await tx.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true } });
  return new Map(owners.map((o) => [o.id, o.displayName]));
}

/** Mirrors `withOwnerNames` — one query for the join rows, one for the
 * distinct users, merged into a per-project list. Feeds `ProjectBoard`'s
 * member checklist (needs to know who's already a member) directly off
 * `projects.list`, no separate data source. */
async function withMembers(tx: PrismaTx, projects: { id: string }[]) {
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return new Map<string, { id: string; displayName: string }[]>();

  const memberships = await tx.projectMember.findMany({ where: { projectId: { in: projectIds } } });
  const userIds = [...new Set(memberships.map((m) => m.userId))];
  const users = userIds.length > 0 ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const byProject = new Map<string, { id: string; displayName: string }[]>();
  for (const m of memberships) {
    const user = userById.get(m.userId);
    if (!user) continue;
    const list = byProject.get(m.projectId) ?? [];
    list.push(user);
    byProject.set(m.projectId, list);
  }
  return byProject;
}

const ListParamsSchema = z.object({ status: z.string().optional() });

export const projectsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "projects.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "project:read",
  async resolve(params, ctx, tx) {
    const where = await projectsWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return [];
    // Phase 1: capped result set, no real cursor pagination yet — `bind.paginate`
    // is honored by the frontend requesting this source, not by pagination
    // logic here. Revisit once a page actually has enough rows to need it.
    const projects = await tx.project.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 });
    // Sequential, not `Promise.all` — concurrent queries against the same
    // transactional `tx` are unsafe (one reserved connection per
    // transaction); see the comment in rbac/role-hierarchy.ts for the real
    // bug this caused elsewhere.
    const ownerNames = await withOwnerNames(tx, projects);
    const membersByProject = await withMembers(tx, projects);
    return projects.map((p) => ({
      ...p,
      owner: p.ownerId ? (ownerNames.get(p.ownerId) ?? null) : null,
      members: membersByProject.get(p.id) ?? [],
    }));
  },
};

const CountParamsSchema = z.object({ status: z.string().optional() });

export const projectsCountDataSource: DataSourceDefinition<z.infer<typeof CountParamsSchema>> = {
  name: "projects.count",
  paramsSchema: CountParamsSchema,
  requiredPermission: "project:read",
  async resolve(params, ctx, tx) {
    const where = await projectsWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return 0;
    return tx.project.count({ where });
  },
};

const StatusBreakdownParamsSchema = z.object({});

// For the dashboard Chart primitive. Same scope-filtering as
// projects.list/projects.count (projectsWhere), grouped by status —
// Prisma's groupBy, not N calls to projects.count per status.
export const projectsStatusBreakdownDataSource: DataSourceDefinition<z.infer<typeof StatusBreakdownParamsSchema>> = {
  name: "projects.statusBreakdown",
  paramsSchema: StatusBreakdownParamsSchema,
  requiredPermission: "project:read",
  async resolve(_params, ctx, tx) {
    const where = await projectsWhere(tx, ctx, {});
    if (!where) return [];
    const groups = await tx.project.groupBy({ by: ["status"], where, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  },
};
