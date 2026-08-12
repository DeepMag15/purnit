import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { projectsWhere } from "../projects/projects.data-sources";

/** Manufacturing Domain, Phase A. Same `*Where()` contract every module
 * follows. No `:own` concept for InventoryItem in this domain's role
 * design — every role that can see items at all sees the whole shared
 * catalog (`:tenant`). */
export async function inventoryItemsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("inventoryItem", "read");
  if (!scope) return null;
  return { tenantId: ctx.tenantId, deletedAt: null, ...extra };
}

/** `inventoryItem:read` and `project:read` are different permissions — an
 * item being visible does NOT mean its spec-doc Project's Documents/Comments
 * are. Reuses `projectsWhere` unchanged, same technique
 * `clients.data-sources.ts`'s `filesVisible`/`patients.data-sources.ts`'s
 * `withChartVisibility` already established — built in from this domain's
 * very first commit, not retrofitted after a live bug report. */
async function filesVisible(tx: PrismaTx, ctx: DataSourceContext, filesProjectId: string): Promise<boolean> {
  const where = await projectsWhere(tx, ctx, { id: filesProjectId });
  if (!where) return false;
  const project = await tx.project.findFirst({ where });
  return !!project;
}

const ListParamsSchema = z.object({ type: z.string().optional(), status: z.string().optional() });

export const inventoryItemsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "inventoryItems.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "inventoryItem:read",
  async resolve(params, ctx, tx) {
    const extra: Record<string, unknown> = {};
    if (params.type) extra.type = params.type;
    if (params.status) extra.status = params.status;
    const where = await inventoryItemsWhere(tx, ctx, extra);
    if (!where) return [];
    return tx.inventoryItem.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

export const inventoryItemDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "inventoryItems.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await inventoryItemsWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No inventory item "${params.id}"`);
    const item = await tx.inventoryItem.findFirst({ where });
    if (!item) throw new NotFoundException(`No inventory item "${params.id}"`);

    const bomLineCount = await tx.bOMLine.count({ where: { tenantId: ctx.tenantId, parentItemId: item.id } });
    const canUpdate = !!ctx.effective.has("inventoryItem", "update");
    const canReadBom = !!ctx.effective.has("bomLine", "read");
    const canCreateDocuments = !!ctx.effective.has("document", "create");
    const canUpdateDocuments = !!ctx.effective.has("document", "update");
    const canDeleteDocuments = !!ctx.effective.has("document", "delete");
    const filesAreVisible = await filesVisible(tx, ctx, item.filesProjectId);

    return {
      ...item,
      bomLineCount,
      canUpdate,
      canReadBom,
      canCreateDocuments,
      canUpdateDocuments,
      canDeleteDocuments,
      filesVisible: filesAreVisible,
    };
  },
};
