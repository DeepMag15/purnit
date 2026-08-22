import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { suppliersWhere } from "./suppliers.data-sources";

/** AI RAG Phase C — no free-text field beyond contact info; synthesizes a
 * composed blurb. */
export const supplierRagHandler: RagSourceHandler = {
  sourceType: "supplier",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const supplier = await tx.supplier.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!supplier) return null;
    const where = await suppliersWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.supplier.findFirst({ where }) : null;
    return inScope ? supplier.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const supplier = await tx.supplier.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!supplier) return null;
    return `${supplier.name} (${supplier.status})${supplier.contactEmail ? `, ${supplier.contactEmail}` : ""}`;
  },
};
