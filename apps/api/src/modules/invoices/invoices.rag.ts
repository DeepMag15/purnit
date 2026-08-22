import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { invoicesWhere } from "./invoices.data-sources";

/** AI RAG Phase C — Invoices is one of the industry-sensitive modules
 * explicitly named in the "include industry-sensitive data uniformly"
 * decision. No free-text field; synthesizes from the linked Client + money
 * fields (already cents, per this schema's own convention). */
export const invoiceRagHandler: RagSourceHandler = {
  sourceType: "invoice",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const invoice = await tx.invoice.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!invoice) return null;
    const where = await invoicesWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.invoice.findFirst({ where }) : null;
    return inScope ? `Invoice (${invoice.status})` : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const invoice = await tx.invoice.findFirst({ where: { id: sourceId, tenantId, deletedAt: null }, include: { client: true } });
    if (!invoice) return null;
    return `Invoice for ${invoice.client.name}, $${(invoice.total / 100).toFixed(2)}, ${invoice.status}, due ${invoice.dueDate.toISOString().slice(0, 10)}`;
  },
};
