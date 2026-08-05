import type { ScalarMetricDefinition, BreakdownMetricDefinition, SnapshotRow, AnalyticsFilters } from "../../metrics/metric-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { tasksWhere } from "./tasks.data-sources";

/** Maps the Analytics-scoped filter vocabulary onto tasksWhere's own params
 * shape — `employeeId` -> `assigneeId` (Task's real column), `departmentId`/
 * `projectId` passed through as-is. Every field optional; an absent filters
 * object (or one with no matching keys) behaves identically to `{}`. */
function filterParams(filters?: AnalyticsFilters) {
  return {
    ...(filters?.employeeId ? { assigneeId: filters.employeeId } : {}),
    ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters?.projectId ? { projectId: filters.projectId } : {}),
  };
}

export const tasksOpenCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "tasks.openCount",
  module: "Tasks",
  label: "Open Tasks",
  requiredPermission: "task:read",
  format: "count",
  drillDown: { source: "tasks.list", params: { status: "todo" } },
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, { status: "todo", ...filterParams(filters) });
    if (!where) return 0;
    return tx.task.count({ where });
  },
};

export const tasksOverdueCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "tasks.overdueCount",
  module: "Tasks",
  label: "Overdue Tasks",
  requiredPermission: "task:read",
  format: "count",
  drillDown: { source: "tasks.list", params: { overdue: true } },
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, { overdue: true, ...filterParams(filters) });
    if (!where) return 0;
    return tx.task.count({ where });
  },
};

async function tenantWideCompletionRate(tx: PrismaTx, tenantId: string): Promise<number> {
  const total = await tx.task.count({ where: { tenantId, deletedAt: null } });
  if (total === 0) return 0;
  const done = await tx.task.count({ where: { tenantId, deletedAt: null, status: "done" } });
  return (done / total) * 100;
}

export const tasksCompletionRateMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "tasks.completionRate",
  module: "Tasks",
  label: "Task Completion Rate",
  requiredPermission: "task:read",
  format: "percent",
  unit: "%",
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, filterParams(filters));
    if (!where) return 0;
    const total = await tx.task.count({ where });
    if (total === 0) return 0;
    const done = await tx.task.count({ where: { ...where, status: "done" } });
    return Math.round((done / total) * 1000) / 10;
  },
  snapshot: {
    // Tenant-wide row PLUS one row per department — a task has no
    // departmentId of its own, reached only through its project (same
    // indirection tasksWhere's department-subtree branch already uses).
    // Tasks whose project has no department are counted in the tenant-wide
    // figure but excluded from every per-department row, never guessed into
    // one.
    async computeDaily(tenantId, tx): Promise<SnapshotRow[]> {
      const tenantValue = Math.round((await tenantWideCompletionRate(tx, tenantId)) * 10) / 10;
      const rows: SnapshotRow[] = [{ departmentId: null, value: tenantValue }];

      const tasks = await tx.task.findMany({
        where: { tenantId, deletedAt: null },
        select: { status: true, project: { select: { departmentId: true } } },
      });
      const totals = new Map<string, { total: number; done: number }>();
      for (const t of tasks) {
        const deptId = t.project.departmentId;
        if (!deptId) continue;
        const bucket = totals.get(deptId) ?? { total: 0, done: 0 };
        bucket.total += 1;
        if (t.status === "done") bucket.done += 1;
        totals.set(deptId, bucket);
      }
      for (const [deptId, { total, done }] of totals) {
        rows.push({ departmentId: deptId, value: total > 0 ? Math.round((done / total) * 1000) / 10 : 0 });
      }
      return rows;
    },
  },
};

export const tasksByPriorityMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "tasks.byPriority",
  module: "Tasks",
  label: "Tasks by Priority",
  requiredPermission: "task:read",
  nameKey: "priority",
  valueKey: "count",
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, filterParams(filters));
    if (!where) return [];
    const groups = await tx.task.groupBy({ by: ["priority"], where, _count: { _all: true } });
    return groups.map((g) => ({ priority: g.priority, count: g._count._all }));
  },
};

// Phase C (Visual & Widget-Type Depth): the first genuinely new pivot in
// this codebase — every prior breakdown metric's groupBy already returns one
// row per category directly; this one groups by (project, status) and
// reshapes into one row per project with one column per status, the shape a
// stacked-bar chart needs.
export const tasksByProjectStatusMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "tasks.byProjectStatus",
  module: "Tasks",
  label: "Tasks by Project & Status",
  requiredPermission: "task:read",
  nameKey: "project",
  valueKey: "todo",
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, filterParams(filters));
    if (!where) return [];
    const groups = await tx.task.groupBy({ by: ["projectId", "status"], where, _count: { _all: true } });
    if (groups.length === 0) return [];

    const projectIds = [...new Set(groups.map((g) => g.projectId))];
    const projects = await tx.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } });
    const nameByProject = new Map(projects.map((p) => [p.id, p.name]));

    const rows = new Map<string, Record<string, unknown>>();
    for (const g of groups) {
      const row = rows.get(g.projectId) ?? { project: nameByProject.get(g.projectId) ?? "Unknown" };
      row[g.status] = g._count._all;
      rows.set(g.projectId, row);
    }
    return [...rows.values()];
  },
};

// Stage order is meaningful for a funnel (unlike a donut's arbitrary order)
// — explicit, not whatever order groupBy happens to return.
const FUNNEL_STAGE_ORDER = ["todo", "in_progress", "done"];

export const tasksStatusFunnelMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "tasks.statusFunnel",
  module: "Tasks",
  label: "Task Status Funnel",
  requiredPermission: "task:read",
  nameKey: "status",
  valueKey: "count",
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, filterParams(filters));
    if (!where) return [];
    const groups = await tx.task.groupBy({ by: ["status"], where, _count: { _all: true } });
    const countByStatus = new Map(groups.map((g) => [g.status, g._count._all]));
    return FUNNEL_STAGE_ORDER.filter((status) => countByStatus.has(status)).map((status) => ({ status, count: countByStatus.get(status)! }));
  },
};

export const tasksCompletionLeaderboardMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "tasks.completionLeaderboard",
  module: "Tasks",
  label: "Task Completion Leaderboard",
  requiredPermission: "task:read",
  nameKey: "assignee",
  valueKey: "count",
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, { ...filterParams(filters), status: "done" });
    if (!where) return [];
    const groups = await tx.task.groupBy({
      by: ["assigneeId"],
      where: { ...where, assigneeId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    });
    if (groups.length === 0) return [];

    const assigneeIds = groups.map((g) => g.assigneeId!);
    const users = await tx.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, displayName: true } });
    const nameByUser = new Map(users.map((u) => [u.id, u.displayName]));

    return groups.map((g) => ({ assignee: nameByUser.get(g.assigneeId!) ?? "Unknown", count: g._count._all }));
  },
};

// A simple two-number-per-assignee comparison (taskCount vs completionRate)
// for the scatter primitive — deliberately NOT Phase F's later "overloaded"
// composite: no threshold, no judgment call, just real counts presented for
// visual comparison.
export const tasksAssigneeWorkloadMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "tasks.assigneeWorkload",
  module: "Tasks",
  label: "Workload vs. Completion by Assignee",
  requiredPermission: "task:read",
  // nameKey/valueKey are metadata only for this widget — its actual scatter
  // rendering uses the row's own x/y fields (AnalyticsWidgetCard hardcodes
  // xKey="x"/yKey="y" for this specific key), since Chart's nameKey/valueKey
  // convention doesn't fit a two-numeric-dimension scatter plot.
  nameKey: "assignee",
  valueKey: "y",
  async computeLive(ctx, tx, filters) {
    const where = await tasksWhere(tx, ctx, filterParams(filters));
    if (!where) return [];
    // Sequential, never Promise.all — both groupBys share this resolver's
    // one transactional tx (CONTEXT.md §9).
    const totalGroups = await tx.task.groupBy({ by: ["assigneeId"], where: { ...where, assigneeId: { not: null } }, _count: { _all: true } });
    if (totalGroups.length === 0) return [];
    const doneGroups = await tx.task.groupBy({
      by: ["assigneeId"],
      where: { ...where, assigneeId: { not: null }, status: "done" },
      _count: { _all: true },
    });
    const doneByAssignee = new Map(doneGroups.map((g) => [g.assigneeId, g._count._all]));

    const assigneeIds = totalGroups.map((g) => g.assigneeId!);
    const users = await tx.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, displayName: true } });
    const nameByUser = new Map(users.map((u) => [u.id, u.displayName]));

    return totalGroups.map((g) => {
      const taskCount = g._count._all;
      const done = doneByAssignee.get(g.assigneeId) ?? 0;
      return {
        assignee: nameByUser.get(g.assigneeId!) ?? "Unknown",
        x: taskCount,
        y: taskCount > 0 ? Math.round((done / taskCount) * 1000) / 10 : 0,
      };
    });
  },
};
