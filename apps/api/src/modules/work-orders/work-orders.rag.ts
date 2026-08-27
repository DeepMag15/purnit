import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { workOrdersWhere } from "./work-orders.data-sources";

/** AI RAG Phase C — WorkOrder has a real free-text `notes` field; embeds
 * real prose when present, otherwise the linked item + status. */
export const workOrderRagHandler: RagSourceHandler = {
  sourceType: "workOrder",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const wo = await tx.workOrder.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!wo) return null;
    const where = await workOrdersWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.workOrder.findFirst({ where }) : null;
    return inScope ? `Work Order (${wo.status})` : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const wo = await tx.workOrder.findFirst({ where: { id: sourceId, tenantId, deletedAt: null }, include: { item: true } });
    if (!wo) return null;
    const base = `Work order for ${wo.item.name} × ${wo.quantity}, ${wo.status}`;
    return wo.notes ? `${base}: ${wo.notes}` : base;
  },
};
