import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { projectsWhere } from "../projects/projects.data-sources";

/** Education Domain, Phase A. Same `*Where()` contract every module follows.
 * `own`/`team`/`department`/`department-subtree` all collapse to "courses I
 * teach" (`teacherId = ctx.userId`) — this branch is inert for the *read*
 * path in Phase A (Teacher/TA/Registrar all hold `course:read:tenant`; the
 * live `:own` exercise for Course happens on *update*, via
 * `requireCourseInScope` in courses.mutations.ts, not through this
 * function's read path — same disclosed shape `patients.data-sources.ts`'s
 * own `patientsWhere` doc comment already established). */
export async function coursesWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("course", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.teacherId = ctx.userId;
  return where;
}

/** The ownership (NOT scope) query `assignments`/`grades` both import to
 * resolve their own `:own` floor transitively through Course. Deliberately
 * does NOT call `coursesWhere` — `coursesWhere` answers "which courses can I
 * *see*" (Teacher holds `course:read:tenant`, broad, mirrors Doctor's
 * `patient:read:tenant`); this answers "which courses do I *teach*" (an
 * ownership fact, independent of read-scope). Routing through `coursesWhere`
 * here would silently widen every Teacher's Assignment/Grade `:own` floor to
 * "every course in the tenant," defeating `:own` scope entirely — the single
 * most important distinction in this whole domain, do not "simplify" it. */
export async function teacherOwnedCourseIds(tx: PrismaTx, ctx: { tenantId: string; userId: string }, teacherId: string = ctx.userId): Promise<string[]> {
  const courses = await tx.course.findMany({
    where: { tenantId: ctx.tenantId, teacherId, deletedAt: null },
    select: { id: true },
  });
  return courses.map((c) => c.id);
}

async function withTeacherNames(tx: PrismaTx, courses: { teacherId: string | null }[]) {
  const teacherIds = [...new Set(courses.map((c) => c.teacherId).filter((id): id is string => !!id))];
  if (teacherIds.length === 0) return new Map<string, string>();
  const teachers = await tx.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, displayName: true } });
  return new Map(teachers.map((t) => [t.id, t.displayName]));
}

async function withEnrolledCounts(tx: PrismaTx, tenantId: string, courses: { id: string }[]) {
  if (courses.length === 0) return new Map<string, number>();
  const grouped = await tx.enrollment.groupBy({
    by: ["courseId"],
    where: { tenantId, status: "enrolled", courseId: { in: courses.map((c) => c.id) } },
    _count: { courseId: true },
  });
  return new Map(grouped.map((g) => [g.courseId, g._count.courseId]));
}

const ListParamsSchema = z.object({ status: z.string().optional() });

export const coursesListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "courses.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "course:read",
  async resolve(params, ctx, tx) {
    const where = await coursesWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return [];
    const courses = await tx.course.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const teacherNames = await withTeacherNames(tx, courses);
    const enrolledCounts = await withEnrolledCounts(tx, ctx.tenantId, courses);
    return courses.map((c) => ({
      ...c,
      teacherName: c.teacherId ? (teacherNames.get(c.teacherId) ?? null) : null,
      enrolledCount: enrolledCounts.get(c.id) ?? 0,
    }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

/** `course:read` and `project:read` are different permissions — Registrar
 * holds the former tenant-wide but zero of the latter (never becomes a
 * course's materialsProject member, see EDUCATION_BLUEPRINT_V1's own role
 * comment), so a Course being visible here does NOT mean its Materials
 * Project's Documents/Comments are. Reuses `projectsWhere` unchanged, same
 * technique `patients.data-sources.ts`'s own `withChartVisibility` already
 * established for Healthcare's `chartVisible` — bounded to just this one
 * course's own materialsProjectId, not every visible project tenant-wide. */
async function materialsVisible(tx: PrismaTx, ctx: DataSourceContext, materialsProjectId: string): Promise<boolean> {
  const where = await projectsWhere(tx, ctx, { id: materialsProjectId });
  if (!where) return false;
  const project = await tx.project.findFirst({ where });
  return !!project;
}

/** Follows `project.detail`'s own precedent exactly. `roster` is computed
 * ungated by `enrollment:read` — visibility rides on reaching `course:read`
 * alone, the same "visibility rides on reaching the parent alone" precedent
 * `project.detail`'s own `members` array already establishes (Teacher/TA can
 * see who's in their class without ever holding `enrollment:*`, which stays
 * exclusively Registrar/Admin — see the Phase A plan's own §0.4). */
export const courseDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "courses.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await coursesWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No course "${params.id}"`);
    const course = await tx.course.findFirst({ where });
    if (!course) throw new NotFoundException(`No course "${params.id}"`);

    const teacherNames = await withTeacherNames(tx, [course]);
    const enrollments = await tx.enrollment.findMany({
      where: { tenantId: ctx.tenantId, courseId: course.id },
      orderBy: { createdAt: "desc" },
    });
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    const students = studentIds.length
      ? await tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } })
      : [];
    const studentNameById = new Map(students.map((s) => [s.id, s.name]));
    const roster = enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      studentName: studentNameById.get(e.studentId) ?? "Unknown",
      status: e.status,
      finalGrade: e.finalGrade,
    }));

    const assignmentCount = await tx.assignment.count({ where: { courseId: course.id, deletedAt: null } });
    const documentCount = await tx.document.count({ where: { projectId: course.materialsProjectId, deletedAt: null } });

    // Same "no pruned actions array on a hand-written route" reasoning
    // project.detail's own capability flags already established.
    const canUpdate = !!ctx.effective.has("course", "update");
    const canReadAssignments = !!ctx.effective.has("assignment", "read");
    const canCreateAssignments = !!ctx.effective.has("assignment", "create");
    // UI-wiring pass — added so AssignmentsGradebookTab.tsx can gate its own
    // "Edit" control on the real assignment:update permission rather than
    // reusing canCreateAssignments as a proxy for a materially different
    // capability, same "don't collapse two distinct grants" lesson as
    // Analytics' canBrowseOrg/canBrowseProjects split.
    const canUpdateAssignments = !!ctx.effective.has("assignment", "update");
    const canEnroll = !!ctx.effective.has("enrollment", "create");
    const canUpdateEnrollments = !!ctx.effective.has("enrollment", "update");
    const canCreateDocuments = !!ctx.effective.has("document", "create");
    const canUpdateDocuments = !!ctx.effective.has("document", "update");
    const canDeleteDocuments = !!ctx.effective.has("document", "delete");
    const materialsAreVisible = await materialsVisible(tx, ctx, course.materialsProjectId);

    return {
      ...course,
      teacherName: course.teacherId ? (teacherNames.get(course.teacherId) ?? null) : null,
      roster,
      assignmentCount,
      documentCount,
      canUpdate,
      canReadAssignments,
      canCreateAssignments,
      canUpdateAssignments,
      canEnroll,
      canUpdateEnrollments,
      canCreateDocuments,
      canUpdateDocuments,
      canDeleteDocuments,
      materialsVisible: materialsAreVisible,
    };
  },
};

const TeacherOptionsParamsSchema = z.object({});

/** Mirrors `patients.doctorOptionsDataSource` exactly — `RoleAssignment` has
 * no Prisma relation to `User` (same no-FK, app-layer convention used
 * everywhere else), so this is the standard two-query join. */
export const coursesTeacherOptionsDataSource: DataSourceDefinition<z.infer<typeof TeacherOptionsParamsSchema>> = {
  name: "courses.teacherOptions",
  paramsSchema: TeacherOptionsParamsSchema,
  requiredPermission: "course:read",
  async resolve(_params, ctx, tx) {
    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId: ctx.tenantId, role: { sourceBlueprintRoleId: "role.teacher" } },
      select: { userId: true },
    });
    if (assignments.length === 0) return [];
    const userIds = [...new Set(assignments.map((a) => a.userId))];
    return tx.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, displayName: true } });
  },
};

const CoursesCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `CoursesWorkspace.tsx`'s move off the
 * generic Renderer loses the `actions` prop — both its own top-level
 * `canCreate` check, and the one it forwards, unchanged, into the nested
 * `KanbanBoard` primitive's own `actions?.some(mutation===updateMutation)`
 * gate for drag-to-update. `course.create`/`course.updateStatus` declare
 * genuinely different resources (`course:create`/`course:update`,
 * confirmed directly), so both get their own flag. No `requiredPermission`
 * of its own (callable by anyone), same precedent as `analytics.capabilities`. */
export const coursesCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof CoursesCapabilitiesParamsSchema>> = {
  name: "courses.capabilities",
  paramsSchema: CoursesCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("course", "create") !== null,
      canUpdateStatus: ctx.effective.has("course", "update") !== null,
    };
  },
};
