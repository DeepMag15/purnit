import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceDefinition } from "../data-sources/data-source-registry.service";
import { assertProjectVisible } from "../modules/documents/documents.data-sources";
import type { ReportLensRegistry } from "./report-lens-registry.service";

/**
 * Contextual Reporting — reading analyses back.
 *
 * No `requiredPermission`: reaching a document's analyses is governed by
 * reaching the document, exactly as `documents.list` and `document.detail`
 * already are. `assertProjectVisible` is the gate, and it is the same one the
 * file itself goes through — so an analysis can never be more reachable than
 * the report it describes.
 *
 * Note this is looser than `reportAnalysis:create` on purpose: a Nurse who
 * cannot commission an analysis should still be able to read the one a Doctor
 * ran on a chart they can already open. Producing insight costs money and
 * carries authority; reading it does not.
 */
const ListParamsSchema = z.object({ documentId: z.string() });

export function createDocumentAnalysesDataSource(lenses: ReportLensRegistry): DataSourceDefinition<z.infer<typeof ListParamsSchema>> {
  return {
    name: "document.analyses",
    paramsSchema: ListParamsSchema,
    async resolve(params, ctx, tx) {
      const document = await tx.document.findFirst({
        where: { id: params.documentId, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!document) throw new NotFoundException(`No document "${params.documentId}"`);
      await assertProjectVisible(tx, ctx, document.projectId);

      // Sequential, not Promise.all — shared-tx rule (CONTEXT.md §9).
      const analyses = await tx.documentAnalysis.findMany({
        where: { tenantId: ctx.tenantId, documentId: document.id },
        orderBy: { createdAt: "desc" },
      });
      const requesterIds = [...new Set(analyses.map((a) => a.requestedById))];
      const requesters = requesterIds.length
        ? await tx.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, displayName: true } })
        : [];
      const nameById = new Map(requesters.map((u) => [u.id, u.displayName]));

      // What THIS caller would get if they ran one now — drives whether the
      // UI offers the button at all, and names the angle before they spend a
      // call finding out.
      const available = await lenses.resolve(tx, ctx, document.projectId);
      const canAnalyze = ctx.effective.has("reportAnalysis", "create") !== null && !!available;

      return {
        canAnalyze,
        availableLens: available ? { key: available.lens.key, label: available.lens.label } : null,
        documentVersion: document.version,
        analyses: analyses.map((a) => ({
          id: a.id,
          lensKey: a.lensKey,
          lensLabel: a.lensLabel,
          summary: a.summary,
          findings: a.findings,
          suggestedActions: a.suggestedActions,
          documentVersion: a.documentVersion,
          // A report replaced since analysis leaves its insights visibly
          // stale rather than quietly wrong.
          stale: a.documentVersion !== document.version,
          requestedByName: nameById.get(a.requestedById) ?? "Unknown",
          createdAt: a.createdAt,
        })),
      };
    },
  };
}
