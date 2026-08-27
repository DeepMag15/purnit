import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Manufacturing Domain, Phase A. Same `*Where()` contract every module
 * follows. No `:own` concept for PurchaseOrder — Procurement Officer's
 * `purchaseOrder:*` and Warehouse Staff's `purchaseOrder:read/receive` are
 * all `:tenant`. */
export async function purchaseOrdersWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("purchaseOrder", "read");
  if (!scope) return null;
  return { tenantId: ctx.tenantId, deletedAt: null, ...extra };
}

async function withSupplierNames(tx: PrismaTx, orders: { supplierId: string }[]) {
  const supplierIds = [...new Set(orders.map((o) => o.supplierId))];
  if (supplierIds.length === 0) return new Map<string, string>();
  const suppliers = await tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } });
  return new Map(suppliers.map((s) => [s.id, s.name]));
}

const ListParamsSchema = z.object({ supplierId: z.string().optional(), status: z.string().optional() });

export const purchaseOrdersListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "purchaseOrders.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "purchaseOrder:read",
  async resolve(params, ctx, tx) {
    const extra: Record<string, unknown> = {};
    if (params.supplierId) extra.supplierId = params.supplierId;
    if (params.status) extra.status = params.status;
    const where = await purchaseOrdersWhere(tx, ctx, extra);
    if (!where) return [];
    const orders = await tx.purchaseOrder.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    const supplierNames = await withSupplierNames(tx, orders);
    return orders.map((po) => ({ ...po, supplierName: supplierNames.get(po.supplierId) ?? "Unknown" }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

export const purchaseOrderDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "purchaseOrders.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await purchaseOrdersWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No purchase order "${params.id}"`);
    const order = await tx.purchaseOrder.findFirst({ where });
    if (!order) throw new NotFoundException(`No purchase order "${params.id}"`);

    const supplierNames = await withSupplierNames(tx, [order]);
    const canUpdate = !!ctx.effective.has("purchaseOrder", "update");
    const canReceive = !!ctx.effective.has("purchaseOrder", "receive");

    return { ...order, supplierName: supplierNames.get(order.supplierId) ?? "Unknown", canUpdate, canReceive };
  },
};

const PurchaseOrdersCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `PurchaseOrdersWorkspace.tsx`'s move off
 * the generic Renderer loses the `actions` prop — both its own top-level
 * `canCreate` check, and the one it forwards, unchanged, into the nested
 * `KanbanBoard` primitive's own `actions?.some(mutation===updateMutation)`
 * gate for drag-to-update. `purchaseOrder.create`/`purchaseOrder.updateStatus`
 * declare genuinely different resources (`purchaseOrder:create`/
 * `purchaseOrder:update`, confirmed directly), so both get their own flag.
 * No `requiredPermission` of its own (callable by anyone), same precedent
 * as `analytics.capabilities`. */
export const purchaseOrdersCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof PurchaseOrdersCapabilitiesParamsSchema>> = {
  name: "purchaseOrders.capabilities",
  paramsSchema: PurchaseOrdersCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("purchaseOrder", "create") !== null,
      canUpdateStatus: ctx.effective.has("purchaseOrder", "update") !== null,
    };
  },
};
