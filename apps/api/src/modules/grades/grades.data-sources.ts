import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { teacherOwnedCourseIds } from "../courses/courses.data-sources";
import { assignmentsWhere } from "../assignments/assignments.data-sources";

/** Education Domain, Phase A. Walks the full three-hop chain: Course →
 * Assignment → Grade. `Grade.gradedById` is null until first graded, so it
 * CANNOT answer a read/create-scope question ("which grades can I see or
 * enter") — only an update-an-already-graded-row question (see
 * grades.mutations.ts's own `grade.update`). Read/create scope is resolved
 * the same way `assignmentsWhere` resolves its own `:own` floor: via
 * `teacherOwnedCourseIds`, never `coursesWhere` (see that function's doc
 * comment for why). */
export async function gradesWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("grade", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, ...extra };
  if (scope === "tenant") return where;

  const courseIds = await teacherOwnedCourseIds(tx, ctx);
  const assignments = courseIds.length
    ? await tx.assignment.findMany({ where: { courseId: { in: courseIds }, deletedAt: null }, select: { id: true } })
    : [];
  where.assignmentId = { in: assignments.map((a) => a.id) };
  return where;
}

const ListParamsSchema = z.object({ assignmentId: z.string() });

/** Simulates a LEFT JOIN against Enrollment so every enrolled student shows
 * a row with `gradeId: null` before they're graded — the frontend gradebook
 * dispatches `grade.record` vs `grade.update` per-cell based on that field
 * (see the Phase A plan's own §0.1). Folds `{id: params.assignmentId}` into
 * `assignmentsWhere` first so an out-of-scope assignment returns `[]`, not
 * every enrolled student's blank row. */
export const gradesListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "grades.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "grade:read",
  async resolve(params, ctx, tx) {
    const assignmentWhere = await assignmentsWhere(tx, ctx, { id: params.assignmentId });
    if (!assignmentWhere) return [];
    const assignment = await tx.assignment.findFirst({ where: assignmentWhere });
    if (!assignment) return [];

    const enrollments = await tx.enrollment.findMany({
      where: { tenantId: ctx.tenantId, courseId: assignment.courseId, status: "enrolled" },
      orderBy: { createdAt: "asc" },
    });
    if (enrollments.length === 0) return [];
    const studentIds = enrollments.map((e) => e.studentId);

    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const students = await tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } });
    const studentNameById = new Map(students.map((s) => [s.id, s.name]));

    const grades = await tx.grade.findMany({ where: { tenantId: ctx.tenantId, assignmentId: assignment.id, studentId: { in: studentIds } } });
    const gradeByStudentId = new Map(grades.map((g) => [g.studentId, g]));

    const graderIds = [...new Set(grades.map((g) => g.gradedById).filter((id): id is string => !!id))];
    const graders = graderIds.length
      ? await tx.user.findMany({ where: { id: { in: graderIds } }, select: { id: true, displayName: true } })
      : [];
    const graderNameById = new Map(graders.map((g) => [g.id, g.displayName]));

    return studentIds.map((studentId) => {
      const grade = gradeByStudentId.get(studentId);
      return {
        studentId,
        studentName: studentNameById.get(studentId) ?? "Unknown",
        gradeId: grade?.id ?? null,
        score: grade?.score ?? null,
        feedback: grade?.feedback ?? null,
        gradedByName: grade?.gradedById ? (graderNameById.get(grade.gradedById) ?? null) : null,
        gradedAt: grade?.gradedAt ?? null,
      };
    });
  },
};
