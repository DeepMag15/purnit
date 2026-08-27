import type { ScalarMetricDefinition, BreakdownMetricDefinition } from "../../metrics/metric-registry.service";
import { clientsWhere } from "./clients.data-sources";

export const clientsTotalCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "clients.totalCount",
  module: "Clients",
  label: "Total Clients",
  requiredPermission: "client:read",
  format: "count",
  async computeLive(ctx, tx) {
    const where = await clientsWhere(tx, ctx);
    if (!where) return 0;
    return tx.client.count({ where });
  },
};

export const clientsStatusBreakdownMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "clients.statusBreakdown",
  module: "Clients",
  label: "Clients by Status",
  requiredPermission: "client:read",
  nameKey: "status",
  valueKey: "count",
  async computeLive(ctx, tx) {
    const where = await clientsWhere(tx, ctx);
    if (!where) return [];
    const groups = await tx.client.groupBy({ by: ["status"], where, _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  },
};
