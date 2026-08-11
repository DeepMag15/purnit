import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { paymentsWhere } from "./payments.data-sources";

// Same local-helper convention appointments.metrics.ts/attendance.metrics.ts
// already use — not shared, a two-line UTC month-boundary helper isn't
// worth a shared util.
function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** "How much cash came in this month" — a real collections signal, not a
 * bare row count. `format: "currency"` — value is cents, formatted
 * client-side. Note `payments.list` requires an `invoiceId` param (a
 * per-invoice ledger view); this metric deliberately queries `tx.payment`
 * directly via `paymentsWhere` with no `invoiceId` filter, a genuinely
 * different, tenant/own-wide aggregation `payments.list` was never built
 * for. */
export const paymentsCollectedThisMonthMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "payments.collectedThisMonth",
  module: "Payments",
  label: "Collected This Month",
  requiredPermission: "payment:read",
  format: "currency",
  async computeLive(ctx, tx) {
    const now = new Date();
    const where = await paymentsWhere(tx, ctx, { paidAt: { gte: startOfUtcMonth(now), lte: now } });
    if (!where) return 0;
    const result = await tx.payment.aggregate({ where, _sum: { amount: true } });
    return result._sum.amount ?? 0;
  },
};
