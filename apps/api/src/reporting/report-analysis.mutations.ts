import { z } from "zod";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { MutationDefinition } from "../mutations/mutation-registry.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../ai/provider/ai-provider.service";
import type { SupabaseAdminService } from "../auth/supabase-admin.service";
import type { PermissionResolverService } from "../rbac/permission-resolver.service";
import type { ReportLensRegistry, ResolvedLens } from "./report-lens-registry.service";
import { extractDocumentText, isExtractable, EXTRACTABLE_MIME_TYPES } from "../ai/embeddings/document-text-extraction";
import { assertProjectVisible } from "../modules/documents/documents.data-sources";
import { resolveTenantProviderOverride } from "../ai/provider/resolve-tenant-provider";
import { selectedProviderKey } from "../ai/provider/ai-provider.service";
import { assertUnderAiDailyCap, DEFAULT_AI_MESSAGE_DAILY_CAP } from "../ai/usage/assert-ai-usage-cap";
import { logAudit } from "../audit/log-audit";

/**
 * Contextual Reporting — "analyse this report", inside the module the report
 * already lives in.
 *
 * Reuses, unchanged: Documents (upload, versioning, `approvalStatus` review),
 * `extractDocumentText` (txt/csv/pdf), `assertProjectVisible` for scope, the
 * AI provider abstraction and its daily usage cap. New here: which *question*
 * gets asked, which comes from `ReportLensRegistry` and therefore from the
 * caller's existing permissions.
 */

const AnalyzeInputSchema = z.object({ documentId: z.string() });

/** Deliberately small and deliberately not free text. A wall of prose is
 * impressive once and useless daily; three-to-six findings with a severity is
 * something a person can act on in a morning. */
const MAX_FINDINGS = 6;
/** Reports get long. Enough for a real CSV export or a multi-page PDF, capped
 * so a 200-page upload cannot turn one click into a huge bill. */
const MAX_CHARS = 24_000;
/** Measured, not guessed: this prompt produces ~500 output tokens, and the
 * reply parses cleanly at 2,500, 8,000 and 16,000 alike. Raising it further
 * buys nothing — see RETRY below for what the real failure actually was. */
const MAX_RESPONSE_TOKENS = 2500;

interface AnalysisPre {
  resolved: ResolvedLens;
  documentName: string;
  documentVersion: number;
  summary: string;
  findings: { label: string; detail: string; severity: string }[];
  suggestedActions: string[];
  provider: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SEVERITIES = new Set(["info", "attention", "risk"]);

/** The model returns JSON, but a model returning JSON is a hope, not a
 * contract — parsed defensively so a malformed reply becomes a clean 400
 * rather than a crash or, worse, a stored analysis full of nulls. */
function parseAnalysis(raw: string): Omit<AnalysisPre, "resolved" | "documentName" | "documentVersion" | "provider" | "usage"> {
  // Models wrap JSON in three different ways depending on provider and mood:
  // a ```json fence, a bare fence, or a sentence of preamble before the object.
  // Peeling the fence and then taking the outermost {...} handles all three,
  // and costs less than a retry.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = (fenced ? fenced[1]! : raw).trim();
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first !== -1 && last > first) body = body.slice(first, last + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // The snippet matters: without it "we couldn't read it" is unactionable
    // for whoever has to work out why, which was exactly the position this
    // put me in during live verification.
    throw new BadRequestException(
      `The analysis came back in a form we couldn't read. Try again in a moment. (got: ${raw.slice(0, 160).replace(/\s+/g, " ")})`,
    );
  }
  const obj = parsed as { summary?: unknown; findings?: unknown; suggestedActions?: unknown };
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!summary) throw new BadRequestException("The analysis came back empty. Try again in a moment.");

  const findings = Array.isArray(obj.findings)
    ? obj.findings
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .slice(0, MAX_FINDINGS)
        .map((f) => ({
          label: String(f.label ?? "").slice(0, 120),
          detail: String(f.detail ?? "").slice(0, 600),
          severity: SEVERITIES.has(String(f.severity)) ? String(f.severity) : "info",
        }))
        .filter((f) => f.label && f.detail)
    : [];

  const suggestedActions = Array.isArray(obj.suggestedActions)
    ? obj.suggestedActions.filter((a): a is string => typeof a === "string" && a.trim().length > 0).slice(0, 5).map((a) => a.trim().slice(0, 240))
    : [];

  return { summary: summary.slice(0, 2000), findings, suggestedActions };
}

function buildPrompt(resolved: ResolvedLens): string {
  return [
    "You are reading a report inside a business workspace and writing back what matters to one specific person.",
    "",
    `They are working in: ${resolved.anchorName}${resolved.anchorDetail ? ` — ${resolved.anchorDetail}` : ""}.`,
    `What they need from this report: ${resolved.lens.focus}`,
    "",
    "Rules:",
    // ⚠️ The linkage sentence is load-bearing. Without it the model refuses to
    // draw findings from a file that doesn't restate its own context — a real
    // class report came back with a good summary and ZERO findings because it
    // "does not identify which student belongs to Algebra II". The file was
    // filed against that course by a person; second-guessing that is not the
    // model's job, and the instruction below was inviting it to.
    `- This report was filed against ${resolved.anchorName} by someone who works there, so treat it as being about ${resolved.anchorName} even if it never says so. Do not withhold findings for lack of a stated link.`,
    `- Otherwise answer ONLY from the report's own contents: if it does not say something, do not infer it. If the file is genuinely unreadable or about something else entirely, say so in the summary and return no findings.`,
    "- Be concrete. Cite the actual numbers, names, dates or rows you are drawing on.",
    "- Keep each finding's detail to one or two sentences. This is read in a sidebar, not a report.",
    `- At most ${MAX_FINDINGS} findings, fewer if the report only supports fewer. Severity: "info" (worth knowing), "attention" (should be looked at), "risk" (needs action).`,
    "- Suggested actions must be things this person can actually do in their role. No generic advice.",
    "",
    "Reply with JSON only, no prose around it:",
    `{"summary": "2-3 sentences", "findings": [{"label": "...", "detail": "...", "severity": "info|attention|risk"}], "suggestedActions": ["..."]}`,
  ].join("\n");
}

export function createDocumentAnalyzeMutation(
  tenantPrisma: TenantPrismaService,
  aiProvider: AiProviderService,
  supabaseAdmin: SupabaseAdminService,
  lenses: ReportLensRegistry,
  permissionResolver: PermissionResolverService,
): MutationDefinition<z.infer<typeof AnalyzeInputSchema>, AnalysisPre> {
  return {
    name: "document.analyze",
    inputSchema: AnalyzeInputSchema,
    // `document:read` does not exist as a triple — reading a document is
    // governed by reaching its project. This gate is the *analysis* right:
    // running one costs real money and produces something that gets stored
    // and reviewed, so it is not simply "can you see the file".
    requiredPermission: "reportAnalysis:create",
    /**
     * ⚠️ Everything expensive happens here, and this hook runs OUTSIDE the
     * main transaction — a real provider call must never hold a DB
     * transaction open. `MutationsController` authorizes before `preResolve`
     * for exactly this reason (ARCHITECTURE.md §15.1, rule 3), so the
     * `requiredPermission` above has already been checked by the time this
     * runs. The per-document scope check below is still done here, because
     * holding `reportAnalysis:create` says nothing about *which* documents.
     */
    async preResolve(input, { tenantId, authUserId }) {
      const prepared = await tenantPrisma.run(tenantId, async (tx) => {
        const user = await tx.user.findFirst({ where: { authUserId, tenantId, deletedAt: null } });
        if (!user) throw new NotFoundException("No user record for this session");

        const document = await tx.document.findFirst({ where: { id: input.documentId, tenantId, deletedAt: null } });
        if (!document) throw new NotFoundException(`No document "${input.documentId}"`);

        const effective = await permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, user.id);
        const ctx = { tenantId, userId: user.id, userDepartmentId: user.departmentId, effective };

        // The same check every document read goes through — a report you
        // cannot open is not a report you can analyse.
        await assertProjectVisible(tx, ctx, document.projectId);

        const resolved = await lenses.resolve(tx, ctx, document.projectId);
        if (!resolved) {
          throw new ForbiddenException(
            "There's no report analysis available for you here. Analysis is shaped by what you work on, and this document isn't attached to something in your remit.",
          );
        }

        if (!isExtractable(document.mimeType)) {
          throw new BadRequestException(
            `We can only read ${[...EXTRACTABLE_MIME_TYPES].join(", ")} for now — "${document.name}" is ${document.mimeType}.`,
          );
        }

        const providerOverride = await resolveTenantProviderOverride(tx, tenantId);
        return { document, resolved, providerOverride };
      });

      // The cap lives on Plan, and Plan is a platform-root table with no RLS —
      // fetched via `root` exactly as `aiMessage.send` does, while the count
      // itself needs a tenant-scoped tx because ai_messages has RLS. An
      // analysis is a real variable-cost call and must sit under the same
      // budget as a chat message, not beside it.
      const tenantRow = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      const plan = tenantRow?.planId ? await tenantPrisma.root.plan.findUnique({ where: { id: tenantRow.planId } }) : null;
      const cap = plan ? plan.aiMessageDailyCap : DEFAULT_AI_MESSAGE_DAILY_CAP;
      await tenantPrisma.run(tenantId, (tx) => assertUnderAiDailyCap(tx, tenantId, cap));

      const bytes = await supabaseAdmin.downloadDocumentBytes(prepared.document.storagePath);
      const text = await extractDocumentText(bytes, prepared.document.mimeType);
      if (!text || !text.trim()) {
        throw new BadRequestException(`"${prepared.document.name}" has no readable text in it.`);
      }

      const userContent = `Report: ${prepared.document.name}\n\n${text.slice(0, MAX_CHARS)}${
        text.length > MAX_CHARS ? "\n\n[report truncated]" : ""
      }`;

      /**
       * ⚠️ One retry, and the reason is worth recording because the first
       * diagnosis was wrong.
       *
       * Live verification failed with unparseable JSON, and the obvious
       * explanation — the reply being truncated at `maxTokens` — was wrong.
       * Measuring it showed ~500 output tokens against a 2,500 budget, and the
       * identical prompt parsing cleanly at 2,500, 8,000 and 16,000. The model
       * simply stops mid-array now and then; Gemini's thinking tokens share the
       * budget, so the visible reply is not a stable function of the limit.
       *
       * Raising the ceiling would have looked like a fix and left an
       * intermittent failure in place. One retry addresses what actually
       * happens — and it is what the error text already told the user to do by
       * hand. Not a loop: two failures in a row is a real problem worth
       * surfacing, not something to keep paying for.
       */
      let result = await aiProvider.complete(
        { systemPrompt: buildPrompt(prepared.resolved), messages: [{ role: "user", content: userContent }], maxTokens: MAX_RESPONSE_TOKENS },
        prepared.providerOverride ?? undefined,
      );
      let parsed: ReturnType<typeof parseAnalysis>;
      try {
        parsed = parseAnalysis(result.content);
      } catch {
        result = await aiProvider.complete(
          {
            systemPrompt: `${buildPrompt(prepared.resolved)}\n\nIMPORTANT: your previous reply was cut off before the JSON closed. Return the COMPLETE JSON object, and keep it short enough to finish.`,
            messages: [{ role: "user", content: userContent }],
            maxTokens: MAX_RESPONSE_TOKENS,
          },
          prepared.providerOverride ?? undefined,
        );
        parsed = parseAnalysis(result.content);
      }

      return {
        resolved: prepared.resolved,
        documentName: prepared.document.name,
        documentVersion: prepared.document.version,
        provider: prepared.providerOverride ?? selectedProviderKey(),
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        ...parsed,
      };
    },
    async resolve(_input, ctx, tx, pre) {
      if (!pre) throw new ForbiddenException("Missing analysis context");

      const analysis = await tx.documentAnalysis.create({
        data: {
          tenantId: ctx.tenantId,
          documentId: _input.documentId,
          documentVersion: pre.documentVersion,
          lensKey: pre.resolved.lens.key,
          lensLabel: pre.resolved.lens.label,
          summary: pre.summary,
          findings: pre.findings,
          suggestedActions: pre.suggestedActions,
          provider: pre.provider,
          inputTokens: pre.usage.inputTokens,
          outputTokens: pre.usage.outputTokens,
          requestedById: ctx.userId,
        },
      });

      // Shows up in the document's existing activity feed beside upload,
      // replace and approval — one timeline, not a separate history nobody
      // thinks to look at.
      await tx.documentActivity.create({
        data: {
          tenantId: ctx.tenantId,
          documentId: _input.documentId,
          actorId: ctx.userId,
          type: "analyzed",
          detail: pre.resolved.lens.label,
        },
      });
      await logAudit(tx, ctx, { action: "document.analyze", resource: "document", resourceId: _input.documentId });

      return analysis;
    },
  };
}
