import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { studentsWhere } from "./students.data-sources";

/** AI RAG Phase C — Students is one of the industry-sensitive modules
 * explicitly named in the "include industry-sensitive data uniformly"
 * decision. No free-text field, so this synthesizes a composed blurb. */
export const studentRagHandler: RagSourceHandler = {
  sourceType: "student",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const student = await tx.student.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!student) return null;
    const where = await studentsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.student.findFirst({ where }) : null;
    return inScope ? student.name : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const student = await tx.student.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    if (!student) return null;
    return `${student.name} (${student.status})`;
  },
};
