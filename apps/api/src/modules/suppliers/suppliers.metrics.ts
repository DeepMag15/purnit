import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import { suppliersWhere } from "./suppliers.data-sources";

export const suppliersTotalCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "suppliers.totalCount",
  module: "Suppliers",
  label: "Total Suppliers",
  requiredPermission: "supplier:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await suppliersWhere(tx, ctx);
    if (!where) return 0;
    return tx.supplier.count({ where });
  },
};
