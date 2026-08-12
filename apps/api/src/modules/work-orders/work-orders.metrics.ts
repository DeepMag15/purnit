import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { workOrdersWhere } from "./work-orders.data-sources";

/** `workOrder:read` is `:tenant`-wide for every role that holds it (the
 * whole shared floor needs schedule visibility, see `workOrdersWhere`'s own
 * doc comment) — this is a genuine shared-floor signal, never narrowed to
 * just a Production Planner's own assigned work orders. */
export const workOrdersInProgressCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "workOrders.inProgressCount",
  module: "Work Orders",
  label: "Work Orders In Progress",
  requiredPermission: "workOrder:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await workOrdersWhere(tx, ctx, { status: "in_progress" });
    if (!where) return 0;
    return tx.workOrder.count({ where });
  },
};
