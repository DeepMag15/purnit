import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { assertConversationMember } from "./chat.mutations";

const ListConversationsParamsSchema = z.object({});

// No requiredPermission — same membership-is-the-scope model as
// chat.mutations.ts; the query itself only ever returns conversations the
// caller belongs to.
export const conversationsListDataSource: DataSourceDefinition<z.infer<typeof ListConversationsParamsSchema>> = {
  name: "conversations.list",
  paramsSchema: ListConversationsParamsSchema,
  async resolve(_params, ctx, tx) {
    const myMemberships = await tx.conversationMember.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.userId } });
    const conversationIds = myMemberships.map((m) => m.conversationId);
    if (conversationIds.length === 0) return [];
    const lastReadById = new Map(myMemberships.map((m) => [m.conversationId, m.lastReadAt]));

    const conversations = await tx.conversation.findMany({
      where: { id: { in: conversationIds }, tenantId: ctx.tenantId, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });

    // Batched, not per-conversation — every other-member/unread/last-message
    // fact below is resolved from these 2 extra queries total, then joined
    // in memory, same graceful-batch discipline as comments.list's
    // author-name resolution (no N+1).
    const allMembers = await tx.conversationMember.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { conversationId: true, userId: true },
    });
    const membersByConversation = new Map<string, string[]>();
    for (const m of allMembers) {
      const list = membersByConversation.get(m.conversationId) ?? [];
      list.push(m.userId);
      membersByConversation.set(m.conversationId, list);
    }

    const otherUserIds = new Set<string>();
    for (const c of conversations) {
      if (c.type !== "dm") continue;
      const other = (membersByConversation.get(c.id) ?? []).find((id) => id !== ctx.userId);
      if (other) otherUserIds.add(other);
    }
    const otherUsers = otherUserIds.size > 0 ? await tx.user.findMany({ where: { id: { in: [...otherUserIds] } }, select: { id: true, displayName: true } }) : [];
    const otherUserNameById = new Map(otherUsers.map((u) => [u.id, u.displayName]));

    const relevantMessages = await tx.message.findMany({
      where: { conversationId: { in: conversationIds }, deletedAt: null },
      select: { conversationId: true, authorId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const lastMessageAtByConversation = new Map<string, Date>();
    const unreadCountByConversation = new Map<string, number>();
    for (const msg of relevantMessages) {
      if (!lastMessageAtByConversation.has(msg.conversationId)) {
        lastMessageAtByConversation.set(msg.conversationId, msg.createdAt);
      }
      if (msg.authorId === ctx.userId) continue;
      const lastReadAt = lastReadById.get(msg.conversationId);
      if (!lastReadAt || msg.createdAt > lastReadAt) {
        unreadCountByConversation.set(msg.conversationId, (unreadCountByConversation.get(msg.conversationId) ?? 0) + 1);
      }
    }

    return conversations.map((c) => {
      const otherMemberId = c.type === "dm" ? (membersByConversation.get(c.id) ?? []).find((id) => id !== ctx.userId) : undefined;
      return {
        id: c.id,
        type: c.type,
        name: c.type === "dm" ? (otherMemberId ? otherUserNameById.get(otherMemberId) ?? "Unknown" : "Unknown") : c.name,
        isPrivate: c.isPrivate,
        createdById: c.createdById,
        otherMember: otherMemberId ? { id: otherMemberId, displayName: otherUserNameById.get(otherMemberId) ?? "Unknown" } : null,
        memberCount: (membersByConversation.get(c.id) ?? []).length,
        unreadCount: unreadCountByConversation.get(c.id) ?? 0,
        lastMessageAt: lastMessageAtByConversation.get(c.id) ?? null,
      };
    });
  },
};

const ListChannelsParamsSchema = z.object({});

// Deliberately ignores any isPrivate the client might pass — always public,
// non-archived channels the caller hasn't joined yet, server-enforced.
export const channelsListDataSource: DataSourceDefinition<z.infer<typeof ListChannelsParamsSchema>> = {
  name: "channels.list",
  paramsSchema: ListChannelsParamsSchema,
  async resolve(_params, ctx, tx) {
    const channels = await tx.conversation.findMany({
      where: { tenantId: ctx.tenantId, type: "channel", isPrivate: false, archivedAt: null, members: { none: { userId: ctx.userId } } },
      orderBy: { createdAt: "desc" },
    });
    return channels.map((c) => ({ id: c.id, name: c.name }));
  },
};

const ListMessagesParamsSchema = z.object({
  conversationId: z.string(),
  before: z.string().optional(),
});

async function withAuthorNames(tx: PrismaTx, messages: { authorId: string }[]) {
  const authorIds = [...new Set(messages.map((m) => m.authorId))];
  const authors = authorIds.length > 0 ? await tx.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true } }) : [];
  return new Map(authors.map((a) => [a.id, a.displayName]));
}

// No requiredPermission — gated entirely by assertConversationMember.
export const messagesListDataSource: DataSourceDefinition<z.infer<typeof ListMessagesParamsSchema>> = {
  name: "messages.list",
  paramsSchema: ListMessagesParamsSchema,
  async resolve(params, ctx, tx) {
    await assertConversationMember(tx, ctx, params.conversationId);

    const messages = await tx.message.findMany({
      where: {
        tenantId: ctx.tenantId,
        conversationId: params.conversationId,
        deletedAt: null,
        createdAt: params.before ? { lt: new Date(params.before) } : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const authorNameById = await withAuthorNames(tx, messages);

    return messages
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        body: m.body,
        authorId: m.authorId,
        authorName: authorNameById.get(m.authorId) ?? "Unknown",
        createdAt: m.createdAt,
      }))
      .reverse(); // oldest-first for direct rendering
  },
};
