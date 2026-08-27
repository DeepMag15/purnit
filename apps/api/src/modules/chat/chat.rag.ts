import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { assertConversationMember } from "./chat.mutations";

/** AI RAG Phase C — real prose (a message's own body). Visibility reuses
 * `assertConversationMember` unchanged (throws if the actor isn't a member
 * of the message's conversation; `RetrievalService`'s own try/catch treats
 * that as "not visible," same as every other handler). No natural "name" —
 * the author's display name would need a join; the conversation id is
 * enough to disambiguate for now, matching how `RetrievedChunk.sourceName`
 * is only ever a citation label, not shown as a hard identity claim. */
export const messageRagHandler: RagSourceHandler = {
  sourceType: "message",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const message = await tx.message.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!message) return null;
    await assertConversationMember(tx, ctx, message.conversationId);
    return "Chat message";
  },
  async extractText(tx, tenantId, sourceId) {
    const message = await tx.message.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    return message?.body?.trim() || null;
  },
};
