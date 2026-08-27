import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { contactsWhere, dealsWhere } from "./crm.data-sources";

/** AI RAG Phase C — neither Contact nor Deal has a free-text notes field
 * (confirmed directly against crm.prisma), so both synthesize a composed
 * blurb from structured fields rather than embedding real prose — same
 * treatment as the industry-sensitive structured-data modules. */
export const contactRagHandler: RagSourceHandler = {
  sourceType: "contact",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const contact = await tx.contact.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!contact) return null;
    const where = await contactsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.contact.findFirst({ where }) : null;
    return inScope ? contact.name : null;
  },
  // AI Assistant Phase F — one batched query instead of N pairs of them.
  async checkVisibilityAndGetNames(tx, ctx, sourceIds) {
    const where = await contactsWhere(tx, ctx, { id: { in: sourceIds } });
    if (!where) return new Map();
    const contacts = await tx.contact.findMany({ where, select: { id: true, name: true } });
    return new Map(contacts.map((c) => [c.id, c.name]));
  },
  async extractText(tx, tenantId, sourceId) {
    const contact = await tx.contact.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!contact) return null;
    const parts = [contact.name, contact.companyName, contact.email, contact.phone].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  },
};

export const dealRagHandler: RagSourceHandler = {
  sourceType: "deal",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const deal = await tx.deal.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!deal) return null;
    const where = await dealsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.deal.findFirst({ where }) : null;
    return inScope ? deal.title : null;
  },
  // AI Assistant Phase F — one batched query instead of N pairs of them.
  async checkVisibilityAndGetNames(tx, ctx, sourceIds) {
    const where = await dealsWhere(tx, ctx, { id: { in: sourceIds } });
    if (!where) return new Map();
    const deals = await tx.deal.findMany({ where, select: { id: true, title: true } });
    return new Map(deals.map((d) => [d.id, d.title]));
  },
  async extractText(tx, tenantId, sourceId) {
    const deal = await tx.deal.findFirst({ where: { id: sourceId, tenantId }, include: { contact: true } });
    if (!deal) return null;
    return `${deal.title} (${deal.stage}) — ${deal.contact.name}${deal.contact.companyName ? ` at ${deal.contact.companyName}` : ""}`;
  },
};
