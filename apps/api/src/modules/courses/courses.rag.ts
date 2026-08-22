import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { coursesWhere } from "./courses.data-sources";

/** AI RAG Phase C — real prose (name + description). */
export const courseRagHandler: RagSourceHandler = {
  sourceType: "course",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const course = await tx.course.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!course) return null;
    const where = await coursesWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.course.findFirst({ where }) : null;
    return inScope ? course.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const course = await tx.course.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!course) return null;
    const text = `${course.name}\n${course.description ?? ""}`.trim();
    return text || null;
  },
};
