import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { coursesWhere } from "./courses.data-sources";

export const coursesActiveCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "courses.activeCount",
  module: "Courses",
  label: "Active Courses",
  requiredPermission: "course:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await coursesWhere(tx, ctx, { status: "active" });
    if (!where) return 0;
    return tx.course.count({ where });
  },
};

// Reuses course:read rather than a new triple — "active teachers" is a
// User/RoleAssignment concept, not a Course concept of its own — same
// reasoning patients.metrics.ts's doctorsActiveCountMetric already
// established for Healthcare.
export const teachersActiveCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "teachers.activeCount",
  module: "Courses",
  label: "Active Teachers",
  requiredPermission: "course:read",
  format: "count",
  async computeLive(ctx, tx) {
    if (!ctx.effective.has("course", "read")) return 0;
    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId: ctx.tenantId, role: { sourceBlueprintRoleId: "role.teacher" } },
      select: { userId: true },
    });
    const userIds = [...new Set(assignments.map((a) => a.userId))];
    if (userIds.length === 0) return 0;
    return tx.user.count({ where: { id: { in: userIds }, tenantId: ctx.tenantId, status: "active", deletedAt: null } });
  },
};
