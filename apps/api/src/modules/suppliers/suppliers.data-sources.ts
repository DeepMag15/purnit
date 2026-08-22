import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Manufacturing Domain, Phase A. Same `*Where()` contract every module
 * follows. Supplier has no `:own` concept anywhere in this domain's role
 * design — Procurement Officer's `supplier:*` is `:tenant`, matching a real
 * vendor-relationship list a whole procurement team shares. */
export async function suppliersWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("supplier", "read");
  if (!scope) return null;
  return { tenantId: ctx.tenantId, deletedAt: null, ...extra };
}

async function withPurchaseOrderCounts(tx: PrismaTx, tenantId: string, suppliers: { id: string }[]) {
  if (suppliers.length === 0) return new Map<string, number>();
  const grouped = await tx.purchaseOrder.groupBy({
    by: ["supplierId"],
    where: { tenantId, deletedAt: null, supplierId: { in: suppliers.map((s) => s.id) } },
    _count: { supplierId: true },
  });
  return new Map(grouped.map((g) => [g.supplierId, g._count.supplierId]));
}

const ListParamsSchema = z.object({ status: z.string().optional() });

export const suppliersListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "suppliers.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "supplier:read",
  async resolve(params, ctx, tx) {
    const where = await suppliersWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return [];
    const suppliers = await tx.supplier.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    const purchaseOrderCounts = await withPurchaseOrderCounts(tx, ctx.tenantId, suppliers);
    return suppliers.map((s) => ({ ...s, purchaseOrderCount: purchaseOrderCounts.get(s.id) ?? 0 }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

export const supplierDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "suppliers.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await suppliersWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No supplier "${params.id}"`);
    const supplier = await tx.supplier.findFirst({ where });
    if (!supplier) throw new NotFoundException(`No supplier "${params.id}"`);

    const purchaseOrderCount = await tx.purchaseOrder.count({ where: { tenantId: ctx.tenantId, supplierId: supplier.id, deletedAt: null } });
    const canUpdate = !!ctx.effective.has("supplier", "update");
    const canReadPurchaseOrders = !!ctx.effective.has("purchaseOrder", "read");

    return { ...supplier, purchaseOrderCount, canUpdate, canReadPurchaseOrders };
  },
};

const SuppliersCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `SuppliersWorkspace.tsx`'s move off the
 * generic Renderer loses the `actions` prop — both its own top-level
 * `canCreate` check, and the one it forwards, unchanged, into the nested
 * `KanbanBoard` primitive's own `actions?.some(mutation===updateMutation)`
 * gate for drag-to-update. `supplier.create`/`supplier.updateStatus` declare
 * genuinely different resources (`supplier:create`/`supplier:update`,
 * confirmed directly), so both get their own flag. No `requiredPermission`
 * of its own (callable by anyone), same precedent as `analytics.capabilities`. */
export const suppliersCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof SuppliersCapabilitiesParamsSchema>> = {
  name: "suppliers.capabilities",
  paramsSchema: SuppliersCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("supplier", "create") !== null,
      canUpdateStatus: ctx.effective.has("supplier", "update") !== null,
    };
  },
};
