import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { inventoryItemsWhere } from "./inventory-items.data-sources";

/** The real "needs reordering" alert this phase exists to deliver — an item
 * exactly at its reorder point still counts as low (`<=`, not `<`), the
 * same boundary a real warehouse would want flagged before stock actually
 * runs out. */
export const inventoryItemsLowStockCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "inventoryItems.lowStockCount",
  module: "Inventory",
  label: "Low Stock Items",
  requiredPermission: "inventoryItem:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await inventoryItemsWhere(tx, ctx);
    if (!where) return 0;
    const items = await tx.inventoryItem.findMany({ where, select: { currentStock: true, reorderPoint: true } });
    return items.filter((i) => i.currentStock <= i.reorderPoint).length;
  },
};

/** `sum(currentStock × unitCost)` across every in-scope item — computed by
 * a bounded fetch + in-process reduce, the same simplification
 * `averageGradePercentMetric` already established for this codebase, not a
 * raw-SQL aggregate. `format: "currency"` — value is cents, formatted
 * client-side. */
export const inventoryItemsTotalValueMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "inventoryItems.totalValue",
  module: "Inventory",
  label: "Total Inventory Value",
  requiredPermission: "inventoryItem:read",
  format: "currency",
  async computeLive(ctx, tx) {
    const where = await inventoryItemsWhere(tx, ctx);
    if (!where) return 0;
    const items = await tx.inventoryItem.findMany({ where, select: { currentStock: true, unitCost: true } });
    return items.reduce((sum, i) => sum + i.currentStock * i.unitCost, 0);
  },
};

export const inventoryItemsTypeBreakdownMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "inventoryItems.typeBreakdown",
  module: "Inventory",
  label: "Inventory by Type",
  requiredPermission: "inventoryItem:read",
  nameKey: "type",
  valueKey: "count",
  async computeLive(ctx, tx) {
    const where = await inventoryItemsWhere(tx, ctx);
    if (!where) return [];
    const groups = await tx.inventoryItem.groupBy({ by: ["type"], where, _count: { _all: true } });
    return groups.map((g) => ({ type: g.type, count: g._count._all }));
  },
};
