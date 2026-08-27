import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition, MutationRegistry } from "../../mutations/mutation-registry.service";
import { checkRequiredPermission } from "../../mutations/mutation-registry.service";
import type { TenantPrismaService, PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../../ai/provider/ai-provider.service";
import { AI_TOOL_ALLOWLIST } from "../../ai/tool-calling/ai-tool-allowlist";
import type { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { assertConversationOwner } from "./ai-assistant.data-sources";
import { AiMessageRoleSchema } from "./ai-message-role";
import { buildSystemPrompt, MAX_HISTORY_MESSAGES, MAX_RESPONSE_TOKENS } from "./ai-assistant.mutations";
import { resolveTenantProviderOverride } from "../../ai/provider/resolve-tenant-provider";
import { assertUnderAiDailyCap, DEFAULT_AI_MESSAGE_DAILY_CAP } from "../../ai/usage/assert-ai-usage-cap";

const MAX_TOOL_RESULT_SUMMARY_LENGTH = 2000;

/** Deterministic, non-LLM summary of what a confirmed tool call actually
 * did — persisted as a "tool"-role AiMessage immediately on execution, so
 * the UI has something real to show even if the follow-up
 * aiToolCall.reply LLM call subsequently fails. */
function summarizeToolResult(mutationName: string, result: unknown): string {
  const json = JSON.stringify(result) ?? "null";
  const body = json.length > MAX_TOOL_RESULT_SUMMARY_LENGTH ? `${json.slice(0, MAX_TOOL_RESULT_SUMMARY_LENGTH)}…` : json;
  return `Tool "${mutationName}" executed successfully. Result: ${body}`;
}

/** Loads a pending proposal owned by the caller, inside the given tx — same
 * tenantId+userId ownership check `assertConversationOwner` uses, inlined
 * here since the caller already has `proposal.conversationId` in hand.
 * Deliberately the same 404 (not 403) whether the proposal doesn't exist or
 * belongs to someone else — don't leak existence to a non-owner. */
async function loadOwnedProposal(tx: PrismaTx, tenantId: string, authUserId: string, proposalId: string) {
  const user = await tx.user.findFirst({ where: { authUserId } });
  if (!user) throw new NotFoundException("No user record for this session");

  const proposal = await tx.aiToolCallProposal.findFirst({ where: { id: proposalId, tenantId } });
  if (!proposal) throw new NotFoundException(`No pending tool call "${proposalId}"`);

  const conversation = await tx.aiConversation.findFirst({ where: { id: proposal.conversationId, tenantId, userId: user.id } });
  if (!conversation) throw new NotFoundException(`No pending tool call "${proposalId}"`);

  return { proposal, user };
}

const ConfirmInputSchema = z.object({ proposalId: z.string() });

interface ConfirmPre {
  proposal: { id: string; conversationId: string; mutationName: string; input: unknown };
  targetDef: MutationDefinition;
  validatedInput: unknown;
  targetPre: unknown;
}

/** Factory (needs `TenantPrismaService` + `MutationRegistry`). Executes the
 * target mutation's own real `resolve()` — same tx, same MutationContext —
 * never a second, parallel dispatch path. No `requiredPermission` of its
 * own, same ownership-only treatment as every other AI Assistant mutation;
 * the real authorization gate is the explicit `checkRequiredPermission`
 * call inside `resolve()` below, re-checked fresh against the *confirming*
 * user's *current* permissions regardless of what was true when the model
 * proposed this call. */
export function createAiToolCallConfirmMutation(
  tenantPrisma: TenantPrismaService,
  mutationRegistry: MutationRegistry,
  permissionResolver: PermissionResolverService,
): MutationDefinition<z.infer<typeof ConfirmInputSchema>, ConfirmPre> {
  return {
    name: "aiToolCall.confirm",
    inputSchema: ConfirmInputSchema,
    async preResolve(input, { tenantId, authUserId }) {
      const { proposal, effective } = await tenantPrisma.run(tenantId, async (tx) => {
        const { proposal: row, user } = await loadOwnedProposal(tx, tenantId, authUserId, input.proposalId);
        if (row.status !== "pending") throw new BadRequestException("This action was already confirmed");
        return { proposal: row, effective: await permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id) };
      });

      const allowlisted = AI_TOOL_ALLOWLIST.some((e) => e.mutationName === proposal.mutationName);
      const targetDef = allowlisted ? mutationRegistry.get(proposal.mutationName) : undefined;
      if (!targetDef) throw new ForbiddenException("This action is no longer available to the AI assistant");

      // Re-validated fresh against the target's CURRENT schema — schemas can
      // evolve between propose and confirm for a long-idle conversation.
      const parsed = targetDef.inputSchema.safeParse(proposal.input);
      if (!parsed.success) throw new BadRequestException("This action's details are no longer valid — ask the assistant to propose it again.");

      // ⚠️ The target's permission, checked BEFORE its own `preResolve` runs.
      // `resolve()` below re-checks this authoritatively against permissions
      // resolved in *that* transaction, and that stays the real gate — but a
      // target's `preResolve` is external-side-effect territory (Stripe calls,
      // provider calls), so it must not run for a caller who will then be
      // refused. This mirrors the pre-flight MutationsController performs for
      // exactly the same reason; without it the assistant would be a way to
      // reach a target's external work without holding its permission.
      //
      // Latent rather than exploitable today — no allowlisted mutation
      // declares a `preResolve` — and a test pins that, so this is the
      // belt to that braces.
      checkRequiredPermission(targetDef, effective);

      const targetPre = await targetDef.preResolve?.(parsed.data, { tenantId, authUserId });
      return { proposal, targetDef, validatedInput: parsed.data, targetPre };
    },
    async rollbackPreResolve(pre) {
      await pre.targetDef.rollbackPreResolve?.(pre.targetPre);
    },
    async resolve(input, ctx: MutationContext, tx, pre) {
      if (!pre) throw new ForbiddenException("Missing tool call context");

      // Atomic claim guarding a double-confirm race — only one caller ever
      // observes count === 1.
      const claimed = await tx.aiToolCallProposal.updateMany({
        where: { id: pre.proposal.id, status: "pending" },
        data: { status: "executed", resolvedAt: new Date() },
      });
      if (claimed.count !== 1) throw new NotFoundException("No pending tool call to confirm");

      // THE mandatory fresh re-check — the literal same function
      // MutationsController itself calls, against ctx.effective freshly
      // resolved for the CONFIRMING user in THIS transaction.
      checkRequiredPermission(pre.targetDef, ctx.effective);

      // Execute via the target mutation's own resolve() — same tx, same
      // ctx — not a parallel reimplementation.
      const result = await pre.targetDef.resolve(pre.validatedInput, ctx, tx, pre.targetPre);

      const summary = summarizeToolResult(pre.proposal.mutationName, result);
      await tx.aiToolCallProposal.update({ where: { id: pre.proposal.id }, data: { resultSummary: summary } });
      await tx.aiMessage.create({ data: { tenantId: ctx.tenantId, conversationId: pre.proposal.conversationId, role: "tool", content: summary } });

      return { proposalId: pre.proposal.id, result };
    },
  };
}

const ReplyInputSchema = z.object({ proposalId: z.string() });

interface ReplyPre {
  conversationId: string;
  assistantContent: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Factory (needs `AiProviderService` + `TenantPrismaService`). A separate
 * mutation from `confirm`, called right after it succeeds — the LLM wrap-up
 * call is external I/O and must not run inside confirm's transaction, and
 * it needs confirm's own committed result (the "tool"-role message) as
 * context. Deliberately not built on `aiMessage.send` — reusing it would
 * force a synthetic fake "user turn" to satisfy its input schema and would
 * drag in RAG retrieval a tool-result wrap-up doesn't need. No `tools` on
 * this completion call — v1 deliberately doesn't chain a second proposal
 * immediately off a reply. */
export function createAiToolCallReplyMutation(
  aiProvider: AiProviderService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof ReplyInputSchema>, ReplyPre> {
  return {
    name: "aiToolCall.reply",
    inputSchema: ReplyInputSchema,
    async preResolve(input, { tenantId, authUserId }) {
      const { conversationId, history, providerOverride } = await tenantPrisma.run(tenantId, async (tx) => {
        const { proposal } = await loadOwnedProposal(tx, tenantId, authUserId, input.proposalId);
        if (proposal.status !== "executed") throw new BadRequestException("This action hasn't been confirmed yet");

        const priorMessages = await tx.aiMessage.findMany({
          where: { tenantId, conversationId: proposal.conversationId },
          orderBy: { createdAt: "desc" },
          take: MAX_HISTORY_MESSAGES,
        });
        // AI Assistant Phase F — read fresh per call, never cached.
        const providerOverride = await resolveTenantProviderOverride(tx, tenantId);
        return { conversationId: proposal.conversationId, history: priorMessages.reverse(), providerOverride };
      });

      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException(`No tenant "${tenantId}"`);

      // AI Assistant Phase F — same daily-cap gate as aiMessage.send, before
      // this real, variable-cost external API call.
      const plan = tenant.planId ? await tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }) : null;
      const cap = plan ? plan.aiMessageDailyCap : DEFAULT_AI_MESSAGE_DAILY_CAP;
      await tenantPrisma.run(tenantId, (tx) => assertUnderAiDailyCap(tx, tenantId, cap));

      const result = await aiProvider.complete(
        {
          systemPrompt: buildSystemPrompt(tenant.name, false),
          messages: history.map((m) => ({ role: AiMessageRoleSchema.parse(m.role), content: m.content })),
          maxTokens: MAX_RESPONSE_TOKENS,
        },
        providerOverride ?? undefined,
      );

      return {
        conversationId,
        assistantContent: result.content,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      };
    },
    async resolve(input, ctx, tx, pre) {
      if (!pre) throw new ForbiddenException("Missing AI reply context");
      // Re-checked here too, same discipline as everywhere else ctx is
      // re-derived fresh per request.
      await assertConversationOwner(tx, ctx, pre.conversationId);

      const message = await tx.aiMessage.create({
        data: { tenantId: ctx.tenantId, conversationId: pre.conversationId, role: "assistant", content: pre.assistantContent, usage: pre.usage },
      });
      await tx.aiConversation.update({ where: { id: pre.conversationId }, data: { updatedAt: new Date() } });
      return message;
    },
  };
}
