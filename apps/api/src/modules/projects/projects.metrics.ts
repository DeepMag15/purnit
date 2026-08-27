import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { projectsWhere, REAL_PROJECT } from "./projects.data-sources";

export const projectsActiveCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "projects.activeCount",
  module: "Projects",
  label: "Active Projects",
  requiredPermission: "project:read",
  format: "count",
  drillDown: { source: "projects.list", params: { status: "active" } },
  async computeLive(ctx, tx, filters) {
    const where = await projectsWhere(tx, ctx, { ...REAL_PROJECT, status: "active", ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}) });
    if (!where) return 0;
    return tx.project.count({ where });
  },
};

// Wraps the same scope-filtered groupBy projects.statusBreakdown (the
// existing dashboard data source) already does — additive, that data source
// is untouched.
export const projectsStatusBreakdownMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "projects.statusBreakdown",
  module: "Projects",
  label: "Projects by Status",
  requiredPermission: "project:read",
  nameKey: "status",
  valueKey: "count",
  async computeLive(ctx, tx, filters) {
    const where = await projectsWhere(tx, ctx, { ...REAL_PROJECT, ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}) });
    if (!where) return [];
    const groups = await tx.project.groupBy({ by: ["status"], where, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  },
};

// Phase F (Cross-Module Composites + Executive Attention) — a ranked list of
// specific at-risk projects, not a single invented "health score" (no real
// basis exists to weight Projects+Tasks+Meetings+Documents into one number —
// see the Phase F plan). "At risk" is a real, disclosed, adjustable
// threshold: more than 30% of a project's own tasks are overdue, with a
// floor of >=3 tasks so a 1-task project doesn't hit 100% on pure noise.
// Deliberately queries Task directly, scoped ONLY to this caller's
// already-resolved visible-project-id list — NOT through tasksWhere's own
// separate task:read scope, which could differ from the caller's
// project:read scope and would silently undercount a project's real task
// total. "At risk" is a property of the project's whole task set, not just
// the tasks this particular caller happens to be individually scoped to see.
export const projectsAtRiskMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "projects.atRisk",
  module: "Projects",
  label: "At-Risk Projects",
  requiredPermission: "project:read",
  nameKey: "project",
  valueKey: "overdueRatio",
  async computeLive(ctx, tx, filters) {
    const where = await projectsWhere(tx, ctx, { ...REAL_PROJECT, ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}) });
    if (!where) return [];
    const projects = await tx.project.findMany({ where, select: { id: true, name: true } });
    if (projects.length === 0) return [];
    const projectIds = projects.map((p) => p.id);
    const nameByProject = new Map(projects.map((p) => [p.id, p.name]));

    // Sequential, never Promise.all — both groupBys share this resolver's
    // one transactional tx (CONTEXT.md §9).
    const totalGroups = await tx.task.groupBy({
      by: ["projectId"],
      where: { tenantId: ctx.tenantId, deletedAt: null, projectId: { in: projectIds } },
      _count: { _all: true },
    });
    const overdueGroups = await tx.task.groupBy({
      by: ["projectId"],
      where: { tenantId: ctx.tenantId, deletedAt: null, projectId: { in: projectIds }, status: { not: "done" }, dueDate: { lt: new Date() } },
      _count: { _all: true },
    });
    const overdueByProject = new Map(overdueGroups.map((g) => [g.projectId, g._count._all]));

    return totalGroups
      .filter((g) => g._count._all >= 3)
      .map((g) => ({
        project: nameByProject.get(g.projectId) ?? "Unknown",
        overdueRatio: Math.round(((overdueByProject.get(g.projectId) ?? 0) / g._count._all) * 1000) / 10,
      }))
      .filter((r) => r.overdueRatio > 30)
      .sort((a, b) => b.overdueRatio - a.overdueRatio)
      .slice(0, 10);
  },
};

/**
 * P5 — how far along a project actually is.
 *
 * `Project.status` is free text and `projects.atRisk` measures overdue-ness,
 * but nothing anywhere answered "how much of this is finished" — so the last
 * step of the delivery workflow, project progress, had nothing to read.
 *
 * Derived from task completion rather than stored on the row: a stored
 * percentage is a second source of truth that drifts the moment a task moves,
 * and every input needed is already in the task table. Projects with no tasks
 * are omitted rather than shown as 0% — "nothing planned yet" and "nothing
 * done yet" are different states and the second is misleading.
 */
export const projectsProgressMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "projects.progress",
  module: "Projects",
  label: "Project Progress",
  requiredPermission: "project:read",
  nameKey: "project",
  valueKey: "percentComplete",
  async computeLive(ctx, tx, filters) {
    const where = await projectsWhere(tx, ctx, { ...REAL_PROJECT, ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}) });
    if (!where) return [];
    const projects = await tx.project.findMany({ where, select: { id: true, name: true } });
    if (projects.length === 0) return [];
    const projectIds = projects.map((p) => p.id);
    const nameByProject = new Map(projects.map((p) => [p.id, p.name]));

    // Sequential, never Promise.all — both groupBys share this resolver's one
    // transactional tx (CONTEXT.md §9).
    const totalGroups = await tx.task.groupBy({
      by: ["projectId"],
      where: { tenantId: ctx.tenantId, deletedAt: null, projectId: { in: projectIds } },
      _count: { _all: true },
    });
    const doneGroups = await tx.task.groupBy({
      by: ["projectId"],
      where: { tenantId: ctx.tenantId, deletedAt: null, projectId: { in: projectIds }, status: "done" },
      _count: { _all: true },
    });
    const doneByProject = new Map(doneGroups.map((g) => [g.projectId, g._count._all]));

    return totalGroups
      .map((g) => ({
        project: nameByProject.get(g.projectId) ?? "Unknown",
        percentComplete: Math.round(((doneByProject.get(g.projectId) ?? 0) / g._count._all) * 100),
      }))
      .sort((a, b) => a.percentComplete - b.percentComplete);
  },
};
