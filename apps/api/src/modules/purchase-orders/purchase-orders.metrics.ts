import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { purchaseOrdersWhere } from "./purchase-orders.data-sources";

/** "Needs attention" — anything not yet received or cancelled. */
export const purchaseOrdersOpenCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "purchaseOrders.openCount",
  module: "Purchase Orders",
  label: "Open Purchase Orders",
  requiredPermission: "purchaseOrder:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await purchaseOrdersWhere(tx, ctx, { status: { in: ["draft", "submitted"] } });
    if (!where) return 0;
    return tx.purchaseOrder.count({ where });
  },
};

/** Real committed spend awaiting receipt — deliberately `"submitted"` only,
 * never `"draft"` (not yet a final commitment). Mirrors
 * `invoicesTotalOutstandingMetric` only counting `"sent"` invoices, never
 * `"draft"` ones. `format: "currency"` — value is cents, formatted
 * client-side. */
export const purchaseOrdersTotalOpenValueMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "purchaseOrders.totalOpenValue",
  module: "Purchase Orders",
  label: "Total Open PO Value",
  requiredPermission: "purchaseOrder:read",
  format: "currency",
  async computeLive(ctx, tx) {
    const where = await purchaseOrdersWhere(tx, ctx, { status: "submitted" });
    if (!where) return 0;
    const result = await tx.purchaseOrder.aggregate({ where, _sum: { total: true } });
    return result._sum.total ?? 0;
  },
};
