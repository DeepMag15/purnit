import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../../ai/provider/ai-provider.service";
import { EmbeddingProviderService } from "../../ai/embeddings/embedding-provider.service";
import type { RetrievalService, RetrievedChunk } from "../../ai/retrieval/retrieval.service";
import type { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { assertConversationOwner } from "./ai-assistant.data-sources";

const MAX_HISTORY_MESSAGES = 20;
// Sized with real headroom for Gemini's thinking tokens, which count
// against this same budget and can't be disabled for gemini-3.6-flash
// (thinkingConfig.thinkingBudget: 0 is rejected by that model — confirmed
// live, see gemini-completion-provider.ts) — a too-tight budget is a real
// documented failure mode (empty response, finishReason "MAX_TOKENS").
const MAX_RESPONSE_TOKENS = 2048;
const TITLE_MAX_LENGTH = 50;
const RETRIEVAL_RESULT_LIMIT = 6;

function buildSystemPrompt(tenantName: string): string {
  return (
    `You are Antigravity's AI assistant for ${tenantName}. You're in an early preview — ` +
    "you can have general conversations and answer general questions, and you can search and answer " +
    "questions about this workspace's documents when relevant context is available below. You don't yet " +
    "have access to projects, tasks, meetings, or any other company data. Say so plainly if asked about " +
    "anything outside of documents, rather than guessing."
  );
}

/** Never persisted as a stored message — recomputed fresh per-turn from the
 * current question, so stale retrieved content never leaks into later
 * turns' replayed history. Chunks are labeled by source document name so
 * the model can cite what it's answering from. */
function buildRetrievalContextBlock(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  const sections = chunks.map((c) => `Document "${c.sourceName}":\n${c.content}`).join("\n\n---\n\n");
  return (
    "The following workspace document excerpts may be relevant to the user's question. " +
    "Answer using only this context when it's relevant; say so plainly if it doesn't contain the answer.\n\n" +
    sections
  );
}

const ContextRefSchema = z.object({ sourceType: z.string(), sourceId: z.string() });

const CreateInputSchema = z.object({ preset: z.string().optional(), contextRef: ContextRefSchema.optional() });

export const aiConversationCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "aiConversation.create",
  inputSchema: CreateInputSchema,
  async resolve(input, ctx, tx) {
    return tx.aiConversation.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, preset: input.preset, contextRef: input.contextRef } });
  },
};

const ArchiveInputSchema = z.object({ id: z.string() });

export const aiConversationArchiveMutation: MutationDefinition<z.infer<typeof ArchiveInputSchema>> = {
  name: "aiConversation.archive",
  inputSchema: ArchiveInputSchema,
  async resolve(input, ctx, tx) {
    await assertConversationOwner(tx, ctx, input.id);
    return tx.aiConversation.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
  },
};

const SendInputSchema = z.object({ conversationId: z.string(), content: z.string().min(1).max(4000) });

interface SendPre {
  assistantContent: string;
  usage: { inputTokens: number; outputTokens: number };
  isFirstMessage: boolean;
}

/** Factory (needs `AiProviderService` + `TenantPrismaService` + Phase B's
 * `EmbeddingProviderService`/`RetrievalService`/`PermissionResolverService`).
 * The completion call — and now the query embedding + retrieval too —
 * happens entirely in `preResolve`, never inside the DB transaction
 * `resolve()` runs in (external I/O never holds a transaction open).
 *
 * Retrieval needs a full `DataSourceContext` (`effective`,
 * `userDepartmentId`) to call `assertProjectVisible`'s Stage-2 check, which
 * `preResolve`'s own `{tenantId, authUserId}` alone can't provide — so this
 * builds one itself, the same way `DataSourcesController.resolve()` does,
 * inside its own short `tenantPrisma.run()` call. */
export function createAiMessageSendMutation(
  aiProvider: AiProviderService,
  tenantPrisma: TenantPrismaService,
  embeddingProvider: EmbeddingProviderService,
  retrievalService: RetrievalService,
  permissionResolver: PermissionResolverService,
): MutationDefinition<z.infer<typeof SendInputSchema>, SendPre> {
  return {
    name: "aiMessage.send",
    inputSchema: SendInputSchema,
    async preResolve(input, { tenantId, authUserId }) {
      const { isFirstMessage, history, contextRef } = await tenantPrisma.run(tenantId, async (tx) => {
        const user = await tx.user.findFirst({ where: { authUserId } });
        if (!user) throw new NotFoundException("No user record for this session");

        // The ownership check itself — a conversation belonging to someone
        // else (or that doesn't exist) 404s here, before any of its history
        // is read or sent to the model.
        const conversation = await tx.aiConversation.findFirst({ where: { id: input.conversationId, tenantId, userId: user.id } });
        if (!conversation) throw new NotFoundException(`No conversation "${input.conversationId}"`);

        const priorMessages = await tx.aiMessage.findMany({
          where: { tenantId, conversationId: input.conversationId },
          orderBy: { createdAt: "desc" },
          take: MAX_HISTORY_MESSAGES,
        });

        return {
          isFirstMessage: priorMessages.length === 0,
          history: priorMessages.reverse(),
          contextRef: conversation.contextRef as { sourceType: string; sourceId: string } | null,
        };
      });

      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException(`No tenant "${tenantId}"`);

      // Retrieval degrades to "no context" rather than failing the whole
      // message if embeddings aren't configured — basic chat (Phase A's
      // core promise) must keep working regardless.
      let retrievedChunks: RetrievedChunk[] = [];
      if (EmbeddingProviderService.isConfigured()) {
        const { vectors } = await embeddingProvider.embed({ texts: [input.content], taskType: "query" });
        const queryVector = vectors[0]!;

        retrievedChunks = await tenantPrisma.run(tenantId, async (tx) => {
          const user = await tx.user.findFirst({ where: { authUserId } });
          if (!user) throw new NotFoundException("No user record for this session");
          const effective = await permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);
          const dataSourceCtx = { tenantId, userId: user.id, userDepartmentId: user.departmentId, effective };
          return retrievalService.retrieve(tx, dataSourceCtx, queryVector, contextRef ?? undefined, RETRIEVAL_RESULT_LIMIT);
        });
      }

      const retrievalBlock = buildRetrievalContextBlock(retrievedChunks);
      const systemPrompt = retrievalBlock ? `${buildSystemPrompt(tenant.name)}\n\n${retrievalBlock}` : buildSystemPrompt(tenant.name);

      const result = await aiProvider.complete({
        systemPrompt,
        messages: [
          ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: input.content },
        ],
        maxTokens: MAX_RESPONSE_TOKENS,
      });

      return { assistantContent: result.content, usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }, isFirstMessage };
    },
    async resolve(input, ctx, tx, pre) {
      // Re-checked here too (cheap, in-transaction) rather than trusting
      // preResolve's check alone — same "no separate authorization path to
      // keep in sync" discipline as everywhere else ctx is re-derived fresh
      // per request.
      await assertConversationOwner(tx, ctx, input.conversationId);
      if (!pre) throw new ForbiddenException("Missing AI response");

      await tx.aiMessage.create({ data: { tenantId: ctx.tenantId, conversationId: input.conversationId, role: "user", content: input.content } });
      const assistantMessage = await tx.aiMessage.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId: input.conversationId,
          role: "assistant",
          content: pre.assistantContent,
          usage: pre.usage,
        },
      });

      await tx.aiConversation.update({
        where: { id: input.conversationId },
        data: {
          updatedAt: new Date(),
          ...(pre.isFirstMessage ? { title: input.content.slice(0, TITLE_MAX_LENGTH) } : {}),
        },
      });

      return assistantMessage;
    },
  };
}
