import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";

/**
 * Applies the granted `task:read` scope to a where-clause — same pattern as
 * `projects.data-sources.ts`'s `projectsWhere`, adapted to Task's shape:
 * "own" means *assigned to me* (`assigneeId`, Task has no `ownerId`
 * concept), and "department"/"team" scope has to reach the department
 * through the owning Project (Task itself has no `departmentId` column).
 *
 * Client-supplied filters (`status`/`overdue`) are always honored as
 * genuine narrowing. `assigneeId` is special: for "own" scope it's always
 * forced to the caller (a client can narrow within their scope but never
 * widen past it — enforced by assignment order, don't reorder). For
 * "team"/"department" scope, a client-supplied `assigneeId` is AND-ed on
 * top of the scope condition below (narrows to "show X's tasks, but only
 * the ones I can actually see").
 *
 * ⚠️ "Assigned to me" is always a floor under team/department scope, not
 * an alternative exclusive condition — same fix, same reasoning, as
 * `isRowInScope` (`rbac/scope-check.ts`). A real, user-reported bug: the
 * old version ANDed the department condition with whatever `assigneeId`
 * the caller (or the blueprint's own `{ ref: "user.id" }` binding on
 * `page.tasks`) supplied, so "my tasks" for a team-scoped Member silently
 * became "my tasks, but only if their project also happens to match my
 * department" — invisible whenever the project had no department, exactly
 * the state real data was in. Fixed with an `OR` between "assigned to me"
 * and "department match," so being the assignee is always sufficient on
 * its own, regardless of the task's project's department.
 */
export async function tasksWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  params: { status?: string; assigneeId?: string; overdue?: boolean; departmentId?: string; projectId?: string },
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("task", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };
  if (params.overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { not: "done" };
  }
  if (params.status) where.status = params.status; // explicit status wins over overdue's implied one
  // Applied uniformly, before scope branching, so every scope path
  // (including the early "own"/"tenant" returns below) inherits the same
  // narrowing — a filter can only ever narrow further, never widen past
  // whatever the scope branch below already permits.
  if (params.projectId) where.projectId = params.projectId;
  if (params.departmentId) where.project = { departmentId: params.departmentId };

  if (scope === "own") {
    where.assigneeId = ctx.userId;
    return where;
  }
  if (scope === "tenant") {
    if (params.assigneeId) where.assigneeId = params.assigneeId;
    return where;
  }
  const scopeConditions: Record<string, unknown>[] = [{ assigneeId: ctx.userId }];

  // ⚠️ Being a member of the project is its own way to be in scope, exactly as
  // `projectsWhere` has long treated it. Without this a Lead could not see
  // work on a project they belong to unless the department happened to match.
  scopeConditions.push({ project: { members: { some: { userId: ctx.userId } } } });

  if (scope === "department-subtree") {
    // Resolved only for this branch — see department-subtree.ts.
    if (ctx.userDepartmentId) {
      const subtreeIds = await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId);
      scopeConditions.push({ project: { departmentId: { in: subtreeIds } } });
    }
  } else if (ctx.userDepartmentId) {
    // team / department — collapsed into one identical exact-match branch,
    // same pre-existing simplification as before (no real team-level
    // distinction today; see isRowInScope's own doc comment).
    scopeConditions.push({ project: { departmentId: ctx.userDepartmentId } });
  }

  // ⚠️ And the ASSIGNEE's own department, not just the project's.
  //
  // "My team's work" is defined by who the person is, but every condition
  // above reads `project.departmentId` — which `project.create` leaves null
  // by default. Verified live: a Lead could not see, and therefore could not
  // review, their own team member's submitted work on a department-less
  // project. Task has no `assignee` relation, so the department's people are
  // resolved explicitly rather than as a nested filter.
  if (scope !== "department-subtree" && ctx.userDepartmentId) {
    const teammates = await tx.user.findMany({
      where: { tenantId: ctx.tenantId, departmentId: ctx.userDepartmentId, deletedAt: null },
      select: { id: true },
    });
    if (teammates.length > 0) scopeConditions.push({ assigneeId: { in: teammates.map((u) => u.id) } });
  }

  where.OR = scopeConditions;
  if (params.assigneeId) where.assigneeId = params.assigneeId;
  return where;
}

const ListParamsSchema = z.object({
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  overdue: z.boolean().optional(),
});

export const tasksListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "tasks.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "task:read",
  async resolve(params, ctx, tx) {
    const where = await tasksWhere(tx, ctx, params);
    if (!where) return [];
    // Phase 1: capped result set, no real cursor pagination yet — same
    // simplification as projects.list (see projects.data-sources.ts).
    return tx.task.findMany({ where, orderBy: { updatedAt: "desc" }, take: 50 });
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

/**
 * Frontend Structural Redesign, Phase 0 — backs the new `/workspace/tasks/[id]`
 * route. Same `document.detail` precedent as `project.detail`: folds `id`
 * into `tasksWhere`'s own scope where-clause (merged on top, since
 * `tasksWhere`'s own params shape has no generic passthrough) rather than a
 * separate existence-then-scope check, so "doesn't exist" and "exists but
 * out of scope" both surface as one `NotFoundException`. No
 * `requiredPermission` beyond what `tasksWhere` already enforces
 * (`task:read`, same as `tasks.list`).
 */
export const taskDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "task.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const scopeWhere = await tasksWhere(tx, ctx, {});
    if (!scopeWhere) throw new NotFoundException(`No task "${params.id}"`);
    const task = await tx.task.findFirst({ where: { ...scopeWhere, id: params.id } });
    if (!task) throw new NotFoundException(`No task "${params.id}"`);

    // Sequential, not Promise.all — same shared-tx rule as every other
    // multi-query resolver in this codebase.
    const assignee = task.assigneeId ? await tx.user.findFirst({ where: { id: task.assigneeId }, select: { displayName: true } }) : null;
    const project = await tx.project.findFirst({ where: { id: task.projectId }, select: { name: true } });

    // Same `chartVisible`-style computed-capability-flag precedent as
    // `project.detail` — a hand-written route has no pruned `actions` array
    // to read from.
    const canUpdate = !!ctx.effective.has("task", "update");
    // Projects ecosystem review — the two halves of the review step, computed
    // the same way. Deliberately separate flags: submitting is ownership
    // (only the assignee), deciding is authority (task:review, and never the
    // assignee). The UI must not offer either one to the wrong person, and it
    // has no pruned `actions` array on this hand-written route to read from.
    const isAssignee = task.assigneeId === ctx.userId;
    const canSubmit = isAssignee && task.status !== "in_review" && task.status !== "done";
    const canReview = !!ctx.effective.has("task", "review") && task.status === "in_review" && !isAssignee && task.submittedById !== ctx.userId;

    const submittedBy = task.submittedById ? await tx.user.findFirst({ where: { id: task.submittedById }, select: { displayName: true } }) : null;
    const reviewedBy = task.reviewedById ? await tx.user.findFirst({ where: { id: task.reviewedById }, select: { displayName: true } }) : null;

    return {
      ...task,
      canUpdate,
      canSubmit,
      canReview,
      isAssignee,
      submittedByName: submittedBy?.displayName ?? null,
      reviewedByName: reviewedBy?.displayName ?? null,
      assigneeName: assignee?.displayName ?? null,
      projectName: project?.name ?? null,
    };
  },
};

const CountParamsSchema = z.object({
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  overdue: z.boolean().optional(),
});

export const tasksCountDataSource: DataSourceDefinition<z.infer<typeof CountParamsSchema>> = {
  name: "tasks.count",
  paramsSchema: CountParamsSchema,
  requiredPermission: "task:read",
  async resolve(params, ctx, tx) {
    const where = await tasksWhere(tx, ctx, params);
    if (!where) return 0;
    return tx.task.count({ where });
  },
};
