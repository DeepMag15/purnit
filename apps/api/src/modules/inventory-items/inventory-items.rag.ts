import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { inventoryItemsWhere } from "./inventory-items.data-sources";

/** AI RAG Phase C — no free-text field; synthesizes from SKU/name/type. */
export const inventoryItemRagHandler: RagSourceHandler = {
  sourceType: "inventoryItem",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const item = await tx.inventoryItem.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!item) return null;
    const where = await inventoryItemsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.inventoryItem.findFirst({ where }) : null;
    return inScope ? item.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const item = await tx.inventoryItem.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!item) return null;
    return `${item.sku} — ${item.name} (${item.type}, ${item.status})`;
  },
};
