import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition, MutationRegistry } from "../../mutations/mutation-registry.service";
import type { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../../ai/provider/ai-provider.service";
import { EmbeddingProviderService } from "../../ai/embeddings/embedding-provider.service";
import type { RetrievalService, RetrievedChunk } from "../../ai/retrieval/retrieval.service";
import type { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { assertConversationOwner } from "./ai-assistant.data-sources";
import { buildToolDeclarations } from "../../ai/tool-calling/build-tool-declarations";
import { AI_TOOL_ALLOWLIST } from "../../ai/tool-calling/ai-tool-allowlist";
import { AiMessageRoleSchema } from "./ai-message-role";
import { resolveTenantProviderOverride } from "../../ai/provider/resolve-tenant-provider";
import { assertUnderAiDailyCap, DEFAULT_AI_MESSAGE_DAILY_CAP } from "../../ai/usage/assert-ai-usage-cap";

export const MAX_HISTORY_MESSAGES = 20;
// Sized with real headroom for Gemini's thinking tokens, which count
// against this same budget and can't be disabled for gemini-3.6-flash
// (thinkingConfig.thinkingBudget: 0 is rejected by that model — confirmed
// live, see gemini-completion-provider.ts) — a too-tight budget is a real
// documented failure mode (empty response, finishReason "MAX_TOKENS").
export const MAX_RESPONSE_TOKENS = 2048;
const TITLE_MAX_LENGTH = 50;
const RETRIEVAL_RESULT_LIMIT = 6;

export function buildSystemPrompt(tenantName: string, toolsOffered: boolean): string {
  const base =
    `You are Purnit's AI assistant for ${tenantName}. ` +
    "You can have general conversations, answer general questions, and search and answer questions " +
    "using relevant workspace context (documents, projects, tasks, and other company data) when it's " +
    "available below. Say so plainly if you don't have enough context to answer, rather than guessing.";
  if (!toolsOffered) return base;
  return (
    base +
    " You can also propose taking an action on the user's behalf using one of the available tools. " +
    "A proposed action is never carried out automatically — the user must explicitly confirm it first. " +
    "Phrase a proposal as something you'd like to do, not as something already done."
  );
}

// "inventoryItem" -> "Inventory Item", "document" -> "Document" — derived
// generically from the RagSourceRegistry's own sourceType strings rather
// than a hardcoded per-type label map, so this never goes stale as new
// source types are registered in future phases.
function humanizeSourceType(sourceType: string): string {
  return sourceType.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** Never persisted as a stored message — recomputed fresh per-turn from the
 * current question, so stale retrieved content never leaks into later
 * turns' replayed history. Chunks are labeled by their real source type +
 * name so the model can cite what it's answering from. */
function buildRetrievalContextBlock(chunks: RetrievedChunk[]): string | null {
  if (chunks.length === 0) return null;
  const sections = chunks.map((c) => `${humanizeSourceType(c.sourceType)} "${c.sourceName}":\n${c.content}`).join("\n\n---\n\n");
  return (
    "The following workspace excerpts may be relevant to the user's question. " +
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
  /** Phase D — the model's raw, unvalidated proposed tool call, if any. Only
   * ever trusted after `resolve()` re-verifies allowlist membership and
   * re-parses `input` against the target mutation's own schema. */
  toolCall?: { name: string; input: unknown };
}

/** Factory (needs `AiProviderService` + `TenantPrismaService` + Phase B's
 * `EmbeddingProviderService`/`RetrievalService`/`PermissionResolverService`,
 * plus Phase D's `MutationRegistry` for tool declarations).
 * The completion call — and now the query embedding + retrieval too —
 * happens entirely in `preResolve`, never inside the DB transaction
 * `resolve()` runs in (external I/O never holds a transaction open).
 *
 * Retrieval needs a full `DataSourceContext` (`effective`,
 * `userDepartmentId`) to call `assertProjectVisible`'s Stage-2 check, which
 * `preResolve`'s own `{tenantId, authUserId}` alone can't provide — so this
 * builds one itself, the same way `DataSourcesController.resolve()` does,
 * inside its own short `tenantPrisma.run()` call. `effective` is resolved
 * unconditionally now (Phase D) rather than only inside the RAG branch,
 * since tool declarations need it regardless of whether embeddings are
 * configured — also lets the RAG branch reuse it instead of re-querying
 * `user` a second time. */
export function createAiMessageSendMutation(
  aiProvider: AiProviderService,
  tenantPrisma: TenantPrismaService,
  embeddingProvider: EmbeddingProviderService,
  retrievalService: RetrievalService,
  permissionResolver: PermissionResolverService,
  mutationRegistry: MutationRegistry,
): MutationDefinition<z.infer<typeof SendInputSchema>, SendPre> {
  return {
    name: "aiMessage.send",
    inputSchema: SendInputSchema,
    async preResolve(input, { tenantId, authUserId }) {
      const { isFirstMessage, history, contextRef, userId, userDepartmentId, effective, providerOverride } = await tenantPrisma.run(
        tenantId,
        async (tx) => {
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

          const effective = await permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);
          // AI Assistant Phase F — read fresh per call, never cached; this
          // one extra query rides along on the same already-open tx.
          const providerOverride = await resolveTenantProviderOverride(tx, tenantId);

          return {
            isFirstMessage: priorMessages.length === 0,
            history: priorMessages.reverse(),
            contextRef: conversation.contextRef as { sourceType: string; sourceId: string } | null,
            userId: user.id,
            userDepartmentId: user.departmentId,
            effective,
            providerOverride,
          };
        },
      );

      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException(`No tenant "${tenantId}"`);

      // AI Assistant Phase F — a real, variable-cost external API call is
      // about to happen; check the tenant's daily cap before any of that
      // work (embedding, retrieval, the completion call itself) begins.
      // `Plan` is a platform-root table (no RLS), fetched via `root` same as
      // `tenant` just above — the count itself needs its own tenant-scoped
      // tx since `ai_messages` has RLS.
      const plan = tenant.planId ? await tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }) : null;
      const cap = plan ? plan.aiMessageDailyCap : DEFAULT_AI_MESSAGE_DAILY_CAP;
      await tenantPrisma.run(tenantId, (tx) => assertUnderAiDailyCap(tx, tenantId, cap));

      // Retrieval degrades to "no context" rather than failing the whole
      // message if embeddings aren't configured — basic chat (Phase A's
      // core promise) must keep working regardless.
      let retrievedChunks: RetrievedChunk[] = [];
      if (EmbeddingProviderService.isConfigured()) {
        const { vectors } = await embeddingProvider.embed({ texts: [input.content], taskType: "query" });
        const queryVector = vectors[0]!;

        retrievedChunks = await tenantPrisma.run(tenantId, async (tx) => {
          const dataSourceCtx = { tenantId, userId, userDepartmentId, effective };
          return retrievalService.retrieve(tx, dataSourceCtx, queryVector, contextRef ?? undefined, RETRIEVAL_RESULT_LIMIT);
        });
      }

      const tools = buildToolDeclarations(mutationRegistry, effective);
      const retrievalBlock = buildRetrievalContextBlock(retrievedChunks);
      const baseSystemPrompt = buildSystemPrompt(tenant.name, tools.length > 0);
      const systemPrompt = retrievalBlock ? `${baseSystemPrompt}\n\n${retrievalBlock}` : baseSystemPrompt;

      const result = await aiProvider.complete(
        {
          systemPrompt,
          messages: [
            ...history.map((m) => ({ role: AiMessageRoleSchema.parse(m.role), content: m.content })),
            { role: "user" as const, content: input.content },
          ],
          maxTokens: MAX_RESPONSE_TOKENS,
          tools: tools.length > 0 ? tools : undefined,
        },
        providerOverride ?? undefined,
      );

      // A model can return empty text alongside a tool call — fall back to a
      // short, friendly framing rather than persisting a blank message.
      const assistantContent =
        result.content ||
        (result.toolCall
          ? `I'd like to ${(AI_TOOL_ALLOWLIST.find((t) => t.mutationName === result.toolCall!.name)?.description ?? `run "${result.toolCall.name}"`).toLowerCase()} — please confirm.`
          : "");

      return {
        assistantContent,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        isFirstMessage,
        toolCall: result.toolCall,
      };
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

      // Never trust the model's proposed tool call just because a tool was
      // offered — re-verify allowlist membership and re-parse `input`
      // against the target mutation's own current schema. Either check
      // failing silently drops the proposal; the text reply above still
      // persists on its own.
      if (pre.toolCall) {
        const allowlisted = AI_TOOL_ALLOWLIST.some((t) => t.mutationName === pre.toolCall!.name);
        const targetDef = allowlisted ? mutationRegistry.get(pre.toolCall.name) : undefined;
        const parsed = targetDef?.inputSchema.safeParse(pre.toolCall.input);
        if (parsed?.success) {
          await tx.aiToolCallProposal.create({
            data: {
              tenantId: ctx.tenantId,
              conversationId: input.conversationId,
              messageId: assistantMessage.id,
              mutationName: pre.toolCall.name,
              input: parsed.data as object,
            },
          });
        }
      }

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
