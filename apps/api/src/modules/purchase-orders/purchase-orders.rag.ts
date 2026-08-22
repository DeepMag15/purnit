import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { purchaseOrdersWhere } from "./purchase-orders.data-sources";

/** AI RAG Phase C — no free-text field; synthesizes from the linked
 * Supplier + status/total. */
export const purchaseOrderRagHandler: RagSourceHandler = {
  sourceType: "purchaseOrder",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const po = await tx.purchaseOrder.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!po) return null;
    const where = await purchaseOrdersWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.purchaseOrder.findFirst({ where }) : null;
    return inScope ? `Purchase Order (${po.status})` : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const po = await tx.purchaseOrder.findFirst({ where: { id: sourceId, tenantId, deletedAt: null }, include: { supplier: true } });
    if (!po) return null;
    return `Purchase order from ${po.supplier.name}, $${(po.total / 100).toFixed(2)}, ${po.status}`;
  },
};
