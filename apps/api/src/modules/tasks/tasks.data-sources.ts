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
  params: { status?: string; assigneeId?: string; overdue?: boolean },
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("task", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };
  if (params.overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { not: "done" };
  }
  if (params.status) where.status = params.status; // explicit status wins over overdue's implied one

  if (scope === "own") {
    where.assigneeId = ctx.userId;
    return where;
  }
  if (scope === "tenant") {
    if (params.assigneeId) where.assigneeId = params.assigneeId;
    return where;
  }
  const scopeConditions: Record<string, unknown>[] = [{ assigneeId: ctx.userId }];
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
