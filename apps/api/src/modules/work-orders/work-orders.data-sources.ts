import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";

/** Manufacturing Domain, Phase A. Same `*Where()` contract every module
 * follows. Unlike `workOrder:update` (real `:own` for Production Planner),
 * `workOrder:read` stays `:tenant` for every role that holds it at all —
 * the whole floor needs shared-schedule visibility, mirrors Doctor's
 * `patient:read:tenant`+`patient:update:own` shape. */
export async function workOrdersWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("workOrder", "read");
  if (!scope) return null;
  return { tenantId: ctx.tenantId, deletedAt: null, ...extra };
}

async function withItemNames(tx: PrismaTx, orders: { itemId: string }[]) {
  const itemIds = [...new Set(orders.map((o) => o.itemId))];
  if (itemIds.length === 0) return new Map<string, { sku: string; name: string }>();
  const items = await tx.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true, name: true } });
  return new Map(items.map((i) => [i.id, { sku: i.sku, name: i.name }]));
}

async function withAssigneeNames(tx: PrismaTx, orders: { assignedToId: string | null }[]) {
  const userIds = [...new Set(orders.map((o) => o.assignedToId).filter((id): id is string => !!id))];
  if (userIds.length === 0) return new Map<string, string>();
  const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

const ListParamsSchema = z.object({ itemId: z.string().optional(), status: z.string().optional() });

export const workOrdersListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "workOrders.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "workOrder:read",
  async resolve(params, ctx, tx) {
    const extra: Record<string, unknown> = {};
    if (params.itemId) extra.itemId = params.itemId;
    if (params.status) extra.status = params.status;
    const where = await workOrdersWhere(tx, ctx, extra);
    if (!where) return [];
    const orders = await tx.workOrder.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    const itemNames = await withItemNames(tx, orders);
    const assigneeNames = await withAssigneeNames(tx, orders);
    return orders.map((wo) => ({
      ...wo,
      item: itemNames.get(wo.itemId) ?? null,
      itemName: itemNames.get(wo.itemId)?.name ?? "Unknown item",
      assignedToName: wo.assignedToId ? (assigneeNames.get(wo.assignedToId) ?? null) : null,
    }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

export const workOrderDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "workOrders.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await workOrdersWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No work order "${params.id}"`);
    const order = await tx.workOrder.findFirst({ where });
    if (!order) throw new NotFoundException(`No work order "${params.id}"`);

    const itemNames = await withItemNames(tx, [order]);
    const assigneeNames = await withAssigneeNames(tx, [order]);
    const updateScope = ctx.effective.has("workOrder", "update");
    const canUpdate = !!updateScope && isRowInScope(updateScope, { ownerId: order.assignedToId }, { userId: ctx.userId });
    const canComplete = !!ctx.effective.has("workOrder", "complete");

    return {
      ...order,
      item: itemNames.get(order.itemId) ?? null,
      assignedToName: order.assignedToId ? (assigneeNames.get(order.assignedToId) ?? null) : null,
      canUpdate,
      canComplete,
    };
  },
};

const WorkOrdersCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `WorkOrdersWorkspace.tsx`'s move off the
 * generic Renderer loses the `actions` prop — both its own top-level
 * `canCreate` check, and the one it forwards, unchanged, into the nested
 * `KanbanBoard` primitive's own `actions?.some(mutation===updateMutation)`
 * gate for drag-to-update. `workOrder.create`/`workOrder.updateStatus`
 * declare genuinely different resources (`workOrder:create`/
 * `workOrder:update`, confirmed directly), so both get their own flag. No
 * `requiredPermission` of its own (callable by anyone), same precedent as
 * `analytics.capabilities`. */
export const workOrdersCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof WorkOrdersCapabilitiesParamsSchema>> = {
  name: "workOrders.capabilities",
  paramsSchema: WorkOrdersCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("workOrder", "create") !== null,
      canUpdateStatus: ctx.effective.has("workOrder", "update") !== null,
    };
  },
};
