import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { bomLinesWhere } from "./bom-lines.data-sources";

/** AI RAG Phase C — no free-text field; synthesizes from the parent +
 * component InventoryItem names. */
export const bomLineRagHandler: RagSourceHandler = {
  sourceType: "bomLine",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const line = await tx.bOMLine.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!line) return null;
    const where = await bomLinesWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.bOMLine.findFirst({ where }) : null;
    return inScope ? "BOM line" : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const line = await tx.bOMLine.findFirst({
      where: { id: sourceId, tenantId },
      include: { parentItem: true, componentItem: true },
    });
    if (!line) return null;
    return `${line.parentItem.name} requires ${line.quantityRequired} × ${line.componentItem.name}`;
  },
};
