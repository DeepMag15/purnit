import { NotFoundException } from "@nestjs/common";
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
/**
 * The gate for a **restricted** project, applied at every scope including
 * `tenant` (Contextual Reporting, 2026-08-25).
 *
 * ⚠️ The hole this closes: `project:read:tenant` returned literally every
 * project in the workspace, and every domain entity is backed by a real
 * Project — so a patient's chart, a student's private submission and a
 * registrar's student file were all readable by anyone holding that grant.
 * Documents live on those projects, so `documents.list` and
 * `document.getFileUrl` inherited the same reach. A Receptionist granted
 * `project:read:tenant` for front-desk paperwork could read every clinical
 * document in the hospital.
 *
 * A restricted project is reachable three ways, and no other:
 *   - you **own** it (a student owns their own submissions project);
 *   - you are a **member** (a patient's assigned doctor, a course's teacher);
 *   - you hold the project's declared `accessPermission` — the role-level
 *     path that lets a Nurse reach any chart without being named on each one.
 *
 * Unrestricted projects behave exactly as before, so ordinary IT projects,
 * course materials, client files and inventory files are untouched.
 */
function restrictedProjectGate(ctx: DataSourceContext): Record<string, unknown> {
  // "resource:action:scope" -> "resource:action". Presence, not scope: holding
  // `patient:update:own` is enough to be a clinical role.
  const held = [...new Set(ctx.effective.toArray().map((g) => g.split(":").slice(0, 2).join(":")))];
  return {
    OR: [
      { restricted: false },
      { ownerId: ctx.userId },
      { members: { some: { userId: ctx.userId } } },
      ...(held.length > 0 ? [{ accessPermission: { in: held } }] : []),
    ],
  };
}

export async function projectsWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("project", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  // Layered with AND so it composes with whatever scope condition follows —
  // a restricted project must be unreachable at EVERY scope, not just tenant.
  const conditions: Record<string, unknown>[] = [restrictedProjectGate(ctx)];

  if (scope === "own") {
    where.ownerId = ctx.userId;
    where.AND = conditions;
    return where;
  }
  if (scope === "tenant") {
    where.AND = conditions;
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
  // AND, not a merged OR: the department path must not become a way around
  // the restriction gate.
  conditions.push({ OR: scopeConditions });
  where.AND = conditions;
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

const DetailParamsSchema = z.object({ id: z.string() });

/**
 * Frontend Structural Redesign, Phase 0 — backs the new `/workspace/projects/[id]`
 * route. Follows `document.detail`'s own precedent exactly: folds the `id`
 * into the same scope-check the row-list source already uses (`projectsWhere`,
 * here via its `extra` passthrough) rather than a separate existence-then-
 * scope check, so "doesn't exist" and "exists but out of scope" both surface
 * as one `NotFoundException` — never leaking which. No `requiredPermission`
 * beyond what `projectsWhere` itself already enforces (`project:read`, same
 * as `projects.list`).
 */
export const projectDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "project.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await projectsWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No project "${params.id}"`);
    const project = await tx.project.findFirst({ where });
    if (!project) throw new NotFoundException(`No project "${params.id}"`);

    // Sequential, not Promise.all — same shared-tx rule as every other
    // multi-query resolver in this codebase (concurrent queries against one
    // transactional `tx` are unsafe).
    const ownerNames = await withOwnerNames(tx, [project]);
    const membersByProject = await withMembers(tx, [project]);
    const department = project.departmentId ? await tx.department.findFirst({ where: { id: project.departmentId }, select: { name: true } }) : null;
    const taskCount = await tx.task.count({ where: { projectId: project.id, deletedAt: null } });
    const documentCount = await tx.document.count({ where: { projectId: project.id, deletedAt: null } });

    // A hand-written detail-page route (unlike a blueprint-driven composite)
    // has no `actions` array pruned server-side to read capability from —
    // same reasoning `patients.list`'s own `chartVisible` flag already
    // established: compute the booleans the frontend needs directly off
    // `ctx.effective`, the identical primitive every mutation's own
    // requiredPermission check already uses. No new authorization concept.
    const canUpdate = !!ctx.effective.has("project", "update");
    const canDelete = !!ctx.effective.has("project", "delete");
    const canCreateDocuments = !!ctx.effective.has("document", "create");
    const canUpdateDocuments = !!ctx.effective.has("document", "update");
    const canDeleteDocuments = !!ctx.effective.has("document", "delete");

    return {
      ...project,
      owner: project.ownerId ? (ownerNames.get(project.ownerId) ?? null) : null,
      departmentName: department?.name ?? null,
      members: membersByProject.get(project.id) ?? [],
      taskCount,
      documentCount,
      canUpdate,
      canDelete,
      canManageMembers: canUpdate,
      canCreateDocuments,
      canUpdateDocuments,
      canDeleteDocuments,
    };
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
