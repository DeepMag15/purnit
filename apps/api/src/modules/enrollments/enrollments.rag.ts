import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import { enrollmentsWhere } from "./enrollments.data-sources";

/** AI RAG Phase C — no name field on Enrollment; synthesizes from the
 * linked Student + Course names, matching the plan's own
 * `extractLeaveRequestText` pattern for structured-data-only modules. */
export const enrollmentRagHandler: RagSourceHandler = {
  sourceType: "enrollment",
  async checkVisibilityAndGetName(tx, ctx, sourceId) {
    const enrollment = await tx.enrollment.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId } });
    if (!enrollment) return null;
    const where = await enrollmentsWhere(tx, ctx, { id: sourceId });
    const inScope = where ? await tx.enrollment.findFirst({ where }) : null;
    return inScope ? "Enrollment" : null;
  },
  async extractText(tx, tenantId, sourceId) {
    const enrollment = await tx.enrollment.findFirst({
      where: { id: sourceId, tenantId },
      include: { student: true, course: true },
    });
    if (!enrollment) return null;
    const grade = enrollment.finalGrade ? `, final grade ${enrollment.finalGrade}` : "";
    return `${enrollment.student.name} enrolled in ${enrollment.course.name} (${enrollment.status}${grade})`;
  },
};
