import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Education Domain, Phase A. Same `*Where()` contract every module in this
 * codebase already follows. `own`/`team`/`department`/`department-subtree`
 * all collapse to "students I registered" — `registeredById` is the only
 * User reference on Student (no assigned-staff field the way Patient has
 * `assignedDoctorId`), so this branch is defensive, not exercised: every
 * Phase A role holding `student:read` holds it at `:tenant` (see the Phase A
 * plan's own §0.5). Only `tenant` scope sees every student. */
export async function studentsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("student", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.registeredById = ctx.userId;
  return where;
}

async function withActiveEnrollmentCounts(tx: PrismaTx, tenantId: string, students: { id: string }[]) {
  if (students.length === 0) return new Map<string, number>();
  const grouped = await tx.enrollment.groupBy({
    by: ["studentId"],
    where: { tenantId, status: "enrolled", studentId: { in: students.map((s) => s.id) } },
    _count: { studentId: true },
  });
  return new Map(grouped.map((g) => [g.studentId, g._count.studentId]));
}

const ListParamsSchema = z.object({ status: z.string().optional() });

export const studentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "students.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "student:read",
  async resolve(params, ctx, tx) {
    const where = await studentsWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return [];
    const students = await tx.student.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const activeEnrollmentCounts = await withActiveEnrollmentCounts(tx, ctx.tenantId, students);
    return students.map((s) => ({ ...s, activeEnrollmentCount: activeEnrollmentCounts.get(s.id) ?? 0 }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

/** Follows `project.detail`'s own precedent exactly: folds `id` into the
 * same scope-check `students.list` already uses, so "doesn't exist" and
 * "exists but out of scope" both surface as one `NotFoundException`.
 * `enrollment:read` is a SEPARATE permission from `student:read` — Teacher
 * holds neither... wait, Teacher holds student:read:tenant but NOT
 * enrollment:read at all (Registrar/Admin only, see the Phase A plan's own
 * §0.4) — so `enrollments` is only populated when `canReadEnrollments` is
 * true, the concrete "structurally excluded" proof for this data source. */
export const studentDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "students.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await studentsWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No student "${params.id}"`);
    const student = await tx.student.findFirst({ where });
    if (!student) throw new NotFoundException(`No student "${params.id}"`);

    const canUpdate = !!ctx.effective.has("student", "update");
    const canReadEnrollments = !!ctx.effective.has("enrollment", "read");
    const enrollments = canReadEnrollments
      ? (
          await tx.enrollment.findMany({
            where: { tenantId: ctx.tenantId, studentId: student.id },
            include: { course: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          })
        ).map((e) => ({
          id: e.id,
          courseId: e.courseId,
          courseName: e.course.name,
          status: e.status,
          finalGrade: e.finalGrade,
        }))
      : [];

    return { ...student, canUpdate, canReadEnrollments, enrollments };
  },
};

const StudentsCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `StudentsWorkspace.tsx`'s move off the
 * generic Renderer loses the `actions` prop — both its own top-level
 * `canCreate` check, and the one it forwards, unchanged, into the nested
 * `KanbanBoard` primitive's own `actions?.some(mutation===updateMutation)`
 * gate for drag-to-update. `student.register`/`student.updateStatus`
 * declare genuinely different resources (`student:create`/`student:update`,
 * confirmed directly), so both get their own flag. No `requiredPermission`
 * of its own (callable by anyone), same precedent as `analytics.capabilities`. */
export const studentsCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof StudentsCapabilitiesParamsSchema>> = {
  name: "students.capabilities",
  paramsSchema: StudentsCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("student", "create") !== null,
      canUpdateStatus: ctx.effective.has("student", "update") !== null,
    };
  },
};
