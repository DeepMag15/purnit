import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { TenantConfigOverrides } from "@purnit/manifest-schema";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { AiProviderService } from "../../ai/provider/ai-provider.service";

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
      include: { toolCallProposal: true },
    });

    return messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      // Phase D — present only for an assistant message that proposed a
      // tool call; the frontend renders a Confirm button while
      // status === "pending", nothing once it's "executed".
      toolCall: m.toolCallProposal
        ? { proposalId: m.toolCallProposal.id, mutationName: m.toolCallProposal.mutationName, input: m.toolCallProposal.input, status: m.toolCallProposal.status }
        : null,
    }));
  },
};

const ProviderSettingsParamsSchema = z.object({});

/** AI Assistant Phase F — read-side for the Settings "AI Provider" card:
 * this tenant's own override (if any), the global env-var default, and
 * which of the 3 provider keys actually have an API key configured in this
 * environment (so the UI can grey out an unusable choice rather than
 * letting an Admin pick one that only fails at first real use). */
export const aiProviderSettingsDataSource: DataSourceDefinition<z.infer<typeof ProviderSettingsParamsSchema>> = {
  name: "ai.providerSettings",
  paramsSchema: ProviderSettingsParamsSchema,
  requiredPermission: "settings:manage",
  async resolve(_params, ctx, tx) {
    const current = await tx.tenantConfig.findFirst({ where: { tenantId: ctx.tenantId, isActive: true } });
    const overrides = current?.overrides as unknown as TenantConfigOverrides | undefined;
    return {
      currentOverride: overrides?.ai?.provider ?? null,
      globalDefault: process.env.AI_COMPLETION_PROVIDER ?? "anthropic",
      configuredProviders: AiProviderService.configuredProviderKeys(),
    };
  },
};
