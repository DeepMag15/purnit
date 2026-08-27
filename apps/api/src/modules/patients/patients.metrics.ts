import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { patientsWhere } from "./patients.data-sources";

export const patientsTotalCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "patients.totalCount",
  module: "Patients",
  label: "Total Patients",
  requiredPermission: "patient:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await patientsWhere(tx, ctx);
    if (!where) return 0;
    return tx.patient.count({ where });
  },
};

export const patientsStatusBreakdownMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "patients.statusBreakdown",
  module: "Patients",
  label: "Patients by Status",
  requiredPermission: "patient:read",
  nameKey: "status",
  valueKey: "count",
  async computeLive(ctx, tx) {
    const where = await patientsWhere(tx, ctx);
    if (!where) return [];
    const groups = await tx.patient.groupBy({ by: ["status"], where, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  },
};

// Reuses patient:read rather than a new triple — "active doctors" is a
// User/RoleAssignment concept, not a Patient concept of its own; gating it
// behind an already-real permission avoids inventing a triple for one
// widget. Composes two small existing patterns (patientsDoctorOptionsData-
// Source's own role:{sourceBlueprintRoleId} join, roles.mutations.ts's own
// roleAssignment.count precedent) — no such count exists verbatim today.
export const doctorsActiveCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "doctors.activeCount",
  module: "Patients",
  label: "Active Doctors",
  requiredPermission: "patient:read",
  format: "count",
  async computeLive(ctx, tx) {
    if (!ctx.effective.has("patient", "read")) return 0;
    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId: ctx.tenantId, role: { sourceBlueprintRoleId: "role.doctor" } },
      select: { userId: true },
    });
    const userIds = [...new Set(assignments.map((a) => a.userId))];
    if (userIds.length === 0) return 0;
    return tx.user.count({ where: { id: { in: userIds }, tenantId: ctx.tenantId, status: "active", deletedAt: null } });
  },
};
