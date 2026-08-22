import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { paymentsWhere } from "./payments.data-sources";

/** AI RAG Phase C — Payments is one of the industry-sensitive modules
 * explicitly named in the "include industry-sensitive data uniformly"
 * decision. Has an optional `notes` field, otherwise synthesizes from
 * amount/method/the linked Invoice's Client. */
export const paymentRagHandler: RagSourceHandler = {
  sourceType: "payment",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const payment = await tx.payment.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!payment) return null;
    const where = await paymentsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.payment.findFirst({ where }) : null;
    return inScope ? `Payment (${payment.method})` : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const payment = await tx.payment.findFirst({
      where: { id: sourceId, tenantId },
      include: { invoice: { include: { client: true } } },
    });
    if (!payment) return null;
    const base = `$${(payment.amount / 100).toFixed(2)} via ${payment.method} for ${payment.invoice.client.name}`;
    return payment.notes ? `${base}: ${payment.notes}` : base;
  },
};
