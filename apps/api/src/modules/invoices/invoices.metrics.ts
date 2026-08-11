import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { invoicesWhere, withAmountsPaid } from "./invoices.data-sources";

/** A naive `status:"sent" AND dueDate<now` count would wrongly include a
 * fully-paid-but-not-yet-voided invoice — "paid" is never a stored status
 * (see invoice.prisma's own doc comment), so a real overdue count must
 * exclude any invoice whose payments already cover its total. Reuses the
 * same `withAmountsPaid` aggregation `invoices.list` already computes. */
export const invoicesOverdueCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "invoices.overdueCount",
  module: "Invoices",
  label: "Overdue Invoices",
  requiredPermission: "invoice:read",
  format: "count",
  async computeLive(ctx, tx) {
    const now = new Date();
    const where = await invoicesWhere(tx, ctx, { status: "sent", dueDate: { lt: now } });
    if (!where) return 0;
    const invoices = await tx.invoice.findMany({ where, select: { id: true, total: true } });
    if (invoices.length === 0) return 0;
    const amountsPaid = await withAmountsPaid(tx, ctx.tenantId, invoices);
    return invoices.filter((inv) => (amountsPaid.get(inv.id) ?? 0) < inv.total).length;
  },
};

/** The headline "how much is owed to us right now" metric — sum of
 * (total - amountPaid) across every sent invoice in scope. `format:
 * "currency"` — value is cents, formatted client-side (see
 * metric-registry.service.ts's own doc comment on the new format). */
export const invoicesTotalOutstandingMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "invoices.totalOutstanding",
  module: "Invoices",
  label: "Total Outstanding",
  requiredPermission: "invoice:read",
  format: "currency",
  async computeLive(ctx, tx) {
    const where = await invoicesWhere(tx, ctx, { status: "sent" });
    if (!where) return 0;
    const invoices = await tx.invoice.findMany({ where, select: { id: true, total: true } });
    if (invoices.length === 0) return 0;
    const amountsPaid = await withAmountsPaid(tx, ctx.tenantId, invoices);
    return invoices.reduce((sum, inv) => sum + Math.max(0, inv.total - (amountsPaid.get(inv.id) ?? 0)), 0);
  },
};
