import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { studentsWhere } from "./students.data-sources";

export const studentsTotalCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "students.totalCount",
  module: "Students",
  label: "Total Students",
  requiredPermission: "student:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await studentsWhere(tx, ctx);
    if (!where) return 0;
    return tx.student.count({ where });
  },
};

export const studentsStatusBreakdownMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "students.statusBreakdown",
  module: "Students",
  label: "Students by Status",
  requiredPermission: "student:read",
  nameKey: "status",
  valueKey: "count",
  async computeLive(ctx, tx) {
    const where = await studentsWhere(tx, ctx);
    if (!where) return [];
    const groups = await tx.student.groupBy({ by: ["status"], where, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  },
};
