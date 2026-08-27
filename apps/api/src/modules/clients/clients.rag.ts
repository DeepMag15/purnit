import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { clientsWhere } from "./clients.data-sources";

/** AI RAG Phase C — no free-text field beyond contact info; synthesizes a
 * composed blurb. */
export const clientRagHandler: RagSourceHandler = {
  sourceType: "client",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const client = await tx.client.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!client) return null;
    const where = await clientsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.client.findFirst({ where }) : null;
    return inScope ? client.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const client = await tx.client.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!client) return null;
    return `${client.name} (${client.status})${client.contactEmail ? `, ${client.contactEmail}` : ""}`;
  },
};
