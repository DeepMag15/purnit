import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** AiConversation is ownership-scoped, same "ownership is the authorization"
 * treatment as Notification — no RBAC triple, just tenantId+userId match. */
export async function assertConversationOwner(tx: PrismaTx, ctx: DataSourceContext, conversationId: string) {
  const conversation = await tx.aiConversation.findFirst({ where: { id: conversationId, tenantId: ctx.tenantId, userId: ctx.userId } });
  if (!conversation) throw new NotFoundException(`No conversation "${conversationId}"`);
  return conversation;
}

const ListConversationsParamsSchema = z.object({});

export const aiConversationsListDataSource: DataSourceDefinition<z.infer<typeof ListConversationsParamsSchema>> = {
  name: "aiConversations.list",
  paramsSchema: ListConversationsParamsSchema,
  async resolve(_params, ctx, tx) {
    const conversations = await tx.aiConversation.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return conversations.map((c) => ({ id: c.id, title: c.title, preset: c.preset, createdAt: c.createdAt, updatedAt: c.updatedAt }));
  },
};

const MessagesParamsSchema = z.object({ conversationId: z.string(), before: z.string().optional() });

export const aiConversationMessagesDataSource: DataSourceDefinition<z.infer<typeof MessagesParamsSchema>> = {
  name: "aiConversation.messages",
  paramsSchema: MessagesParamsSchema,
  async resolve(params, ctx, tx) {
    await assertConversationOwner(tx, ctx, params.conversationId);

    const messages = await tx.aiMessage.findMany({
      where: {
        tenantId: ctx.tenantId,
        conversationId: params.conversationId,
        createdAt: params.before ? { lt: new Date(params.before) } : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return messages.map((m) => ({ id: m.id, conversationId: m.conversationId, role: m.role, content: m.content, createdAt: m.createdAt }));
  },
};
