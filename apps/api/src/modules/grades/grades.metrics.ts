import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { gradesWhere } from "./grades.data-sources";

// Averages score/maxScore per graded row in-process rather than a raw-SQL
// AVG expression — a deliberate, bounded simplification: the row count here
// is "graded submissions in scope," realistically small per tenant, same
// category of accepted app-level aggregation grades.data-sources.ts's own
// LEFT-JOIN simulation (gradesListDataSource) already uses.
export const averageGradePercentMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "grades.averagePercent",
  module: "Grades",
  label: "Average Grade",
  requiredPermission: "grade:read",
  format: "percent",
  unit: "%",
  async computeLive(ctx, tx) {
    const where = await gradesWhere(tx, ctx, { score: { not: null } });
    if (!where) return 0;
    const grades = await tx.grade.findMany({ where, select: { score: true, assignment: { select: { maxScore: true } } } });
    if (grades.length === 0) return 0;
    const total = grades.reduce((sum, g) => sum + (g.score! / g.assignment.maxScore) * 100, 0);
    return Math.round((total / grades.length) * 10) / 10;
  },
};

export const gradesRecordedCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "grades.recordedCount",
  module: "Grades",
  label: "Grades Recorded",
  requiredPermission: "grade:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await gradesWhere(tx, ctx, { score: { not: null } });
    if (!where) return 0;
    return tx.grade.count({ where });
  },
};
