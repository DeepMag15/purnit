import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { appointmentsWhere } from "./appointments.data-sources";

// Same local-helper convention attendance.metrics.ts already uses — not
// shared, a two-line UTC day-boundary helper isn't worth a shared util.
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export const appointmentsTodayCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "appointments.todayCount",
  module: "Appointments",
  label: "Today's Appointments",
  requiredPermission: "appointment:read",
  format: "count",
  async computeLive(ctx, tx) {
    const now = new Date();
    const where = await appointmentsWhere(tx, ctx, { scheduledStart: { gte: startOfUtcDay(now), lte: endOfUtcDay(now) } });
    if (!where) return 0;
    return tx.appointment.count({ where });
  },
};

export const appointmentsCompletedCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "appointments.completedCount",
  module: "Appointments",
  label: "Completed Appointments",
  requiredPermission: "appointment:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await appointmentsWhere(tx, ctx, { status: "completed" });
    if (!where) return 0;
    return tx.appointment.count({ where });
  },
};
