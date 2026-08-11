import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { enrollmentsWhere } from "./enrollments.data-sources";

// Gated on enrollment:read — deliberately invisible to Teacher/TA (neither
// holds it, only Admin/Registrar do), the domain's own established
// differentiation (see EDUCATION_BLUEPRINT_V1's role definitions), not an
// oversight.
export const enrollmentsActiveCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "enrollments.activeCount",
  module: "Enrollments",
  label: "Active Enrollments",
  requiredPermission: "enrollment:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await enrollmentsWhere(tx, ctx, { status: "enrolled" });
    if (!where) return 0;
    return tx.enrollment.count({ where });
  },
};
