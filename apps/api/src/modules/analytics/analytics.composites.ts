import type { CompositeMetricDefinition } from "../../metrics/metric-registry.service";

/** Phase F's first (and, for now, only) composite — proves the
 * CompositeMetricDefinition mechanism for real rather than forcing several
 * hand-wavy cross-module blends just to hit a number. An unweighted average
 * of two already-0-100 percentages with matching semantics (% tasks
 * complete, % days present) — not incorporating meeting cadence or AI usage,
 * since neither has a clean 0-100 percentage shape today; forcing one in
 * would mean inventing a second, less-defensible formula just to use more
 * ingredients. A disclosed, adjustable judgment call, not a validated model. */
export const employeeProductivityScoreMetric: CompositeMetricDefinition = {
  kind: "composite",
  key: "employeeProductivityScore",
  module: "Cross-Module",
  label: "Employee Productivity Score",
  format: "percent",
  ingredients: ["tasks.completionRate", "attendance.rateThisMonth"],
  combine: (values) => Math.round(((values["tasks.completionRate"] ?? 0) + (values["attendance.rateThisMonth"] ?? 0)) / 2),
};
