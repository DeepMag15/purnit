import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { projectsWhere } from "./projects.data-sources";

export const projectsActiveCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "projects.activeCount",
  module: "Projects",
  label: "Active Projects",
  requiredPermission: "project:read",
  format: "count",
  drillDown: { source: "projects.list", params: { status: "active" } },
  async computeLive(ctx, tx, filters) {
    const where = await projectsWhere(tx, ctx, { status: "active", ...(filters?.departmentId ? { departmentId: filters.departmentId } : {}) });
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
    const where = await projectsWhere(tx, ctx, filters?.departmentId ? { departmentId: filters.departmentId } : {});
    if (!where) return [];
    const groups = await tx.project.groupBy({ by: ["status"], where, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  },
};
