import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { assignmentsWhere } from "./assignments.data-sources";

/** AI RAG Phase C — real prose (title + description). */
export const assignmentRagHandler: RagSourceHandler = {
  sourceType: "assignment",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const assignment = await tx.assignment.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!assignment) return null;
    const where = await assignmentsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.assignment.findFirst({ where }) : null;
    return inScope ? assignment.title : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const assignment = await tx.assignment.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!assignment) return null;
    const text = `${assignment.title}\n${assignment.description ?? ""}`.trim();
    return text || null;
  },
};
