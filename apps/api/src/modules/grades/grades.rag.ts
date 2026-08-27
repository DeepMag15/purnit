import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { gradesWhere } from "./grades.data-sources";

/** AI RAG Phase C — Grades is one of the industry-sensitive modules
 * explicitly named in the "include industry-sensitive data uniformly"
 * decision. No name field on Grade; synthesizes from the linked Student +
 * Assignment, matching the plan's own `extractLeaveRequestText` pattern. */
export const gradeRagHandler: RagSourceHandler = {
  sourceType: "grade",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const grade = await tx.grade.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!grade) return null;
    const where = await gradesWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.grade.findFirst({ where }) : null;
    return inScope ? "Grade" : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const grade = await tx.grade.findFirst({
      where: { id: sourceId, tenantId },
      include: { student: true, assignment: true },
    });
    if (!grade) return null;
    const scoreText = grade.score === null ? "ungraded" : `${grade.score}/${grade.assignment.maxScore}`;
    const feedback = grade.feedback ? `: ${grade.feedback}` : "";
    return `${grade.student.name} — ${grade.assignment.title}, ${scoreText}${feedback}`;
  },
};
