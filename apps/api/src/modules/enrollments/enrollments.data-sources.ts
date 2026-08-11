import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Education Domain, Phase A. Same `*Where()` contract every module follows.
 * `own`/`team`/`department`/`department-subtree` collapse to "enrollments I
 * created" — defensive, not exercised (only Admin/Registrar hold
 * `enrollment:read`, both `:tenant`, mirrors `students.data-sources.ts`'s
 * own disclosed shape). */
export async function enrollmentsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("enrollment", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, ...extra };
  if (scope === "tenant") return where;
  where.enrolledById = ctx.userId;
  return where;
}

const ListParamsSchema = z.object({ studentId: z.string().optional(), courseId: z.string().optional() });

/** Primary consumer: `StudentDetail`'s Enrollments tab (gated client-side on
 * `students.detail`'s own `canReadEnrollments` flag). */
export const enrollmentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "enrollments.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "enrollment:read",
  async resolve(params, ctx, tx) {
    const extra: Record<string, unknown> = {};
    if (params.studentId) extra.studentId = params.studentId;
    if (params.courseId) extra.courseId = params.courseId;
    const where = await enrollmentsWhere(tx, ctx, extra);
    if (!where) return [];

    const enrollments = await tx.enrollment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { course: { select: { id: true, name: true } } },
    });
    if (enrollments.length === 0) return [];

    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    const students = await tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } });
    const studentNameById = new Map(students.map((s) => [s.id, s.name]));

    return enrollments.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      studentName: studentNameById.get(e.studentId) ?? "Unknown",
      courseId: e.courseId,
      courseName: e.course.name,
      status: e.status,
      finalGrade: e.finalGrade,
    }));
  },
};
