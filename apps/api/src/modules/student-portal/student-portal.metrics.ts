import type { ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/**
 * Student Role — the numbers a student opens their day on.
 *
 * All four are gated on `studentPortal:read` and scoped to the caller's own
 * Student row, so they are inert for every staff role: a Teacher holds no
 * `studentPortal:read`, so the widget is pruned before it renders. That is
 * what lets the Student dashboard reuse the existing dashboard engine
 * unchanged rather than needing a student-shaped one.
 *
 * Deliberately no `snapshot` on any of them. Snapshots exist to give KpiCards
 * trend history, and "how many assignments are due this week" is a fact about
 * right now, not a series worth storing — a 2,000-student college would write
 * thousands of snapshot rows a day for numbers nobody plots.
 */

/** The caller's own Student row id, or null when this login isn't linked to
 * one. Every metric here returns 0 in that case rather than throwing: a
 * dashboard widget that 500s is a worse answer than a zero, and the portal
 * pages themselves already explain the unlinked state properly. */
async function ownStudentId(ctx: DataSourceContext, tx: PrismaTx): Promise<string | null> {
  const student = await tx.student.findFirst({
    where: { tenantId: ctx.tenantId, userId: ctx.userId, deletedAt: null },
    select: { id: true },
  });
  return student?.id ?? null;
}

/** Courses the student is actually taking. Shared by three of the four
 * metrics below, and the reason none of them reimplements enrolment scope. */
async function myCourseIds(ctx: DataSourceContext, tx: PrismaTx, studentId: string): Promise<string[]> {
  const enrolments = await tx.enrollment.findMany({
    where: { tenantId: ctx.tenantId, studentId, status: { in: ["enrolled", "completed"] } },
    select: { courseId: true },
  });
  return enrolments.map((e) => e.courseId);
}

export const myOpenAssignmentsMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "student.openAssignments",
  module: "Student portal",
  label: "Open assignments",
  requiredPermission: "studentPortal:read",
  format: "count",
  async computeLive(ctx, tx) {
    const studentId = await ownStudentId(ctx, tx);
    if (!studentId) return 0;
    const courseIds = await myCourseIds(ctx, tx, studentId);
    if (courseIds.length === 0) return 0;

    // Sequential, not Promise.all — same shared-tx rule as every other
    // multi-query resolver in this codebase (CONTEXT.md §9).
    const assignments = await tx.assignment.findMany({
      where: { tenantId: ctx.tenantId, courseId: { in: courseIds }, deletedAt: null },
      select: { id: true },
    });
    if (assignments.length === 0) return 0;

    const graded = await tx.grade.count({
      where: {
        tenantId: ctx.tenantId,
        studentId,
        assignmentId: { in: assignments.map((a) => a.id) },
        NOT: { score: null },
      },
    });
    return assignments.length - graded;
  },
};

export const myDueThisWeekMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "student.dueThisWeek",
  module: "Student portal",
  label: "Due this week",
  requiredPermission: "studentPortal:read",
  format: "count",
  async computeLive(ctx, tx) {
    const studentId = await ownStudentId(ctx, tx);
    if (!studentId) return 0;
    const courseIds = await myCourseIds(ctx, tx, studentId);
    if (courseIds.length === 0) return 0;

    const now = new Date();
    const weekOut = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const due = await tx.assignment.findMany({
      where: {
        tenantId: ctx.tenantId,
        courseId: { in: courseIds },
        deletedAt: null,
        dueDate: { gte: now, lte: weekOut },
      },
      select: { id: true },
    });
    if (due.length === 0) return 0;

    const graded = await tx.grade.count({
      where: { tenantId: ctx.tenantId, studentId, assignmentId: { in: due.map((a) => a.id) }, NOT: { score: null } },
    });
    return due.length - graded;
  },
};

export const myCourseCountMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "student.courseCount",
  module: "Student portal",
  label: "My courses",
  requiredPermission: "studentPortal:read",
  format: "count",
  drillDown: { source: "myCourses.list", params: {} },
  async computeLive(ctx, tx) {
    const studentId = await ownStudentId(ctx, tx);
    if (!studentId) return 0;
    return tx.enrollment.count({ where: { tenantId: ctx.tenantId, studentId, status: "enrolled" } });
  },
};

export const myAttendanceRateMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "student.attendanceRate",
  module: "Student portal",
  label: "My attendance",
  requiredPermission: "studentPortal:read",
  format: "percent",
  async computeLive(ctx, tx) {
    // Reuses the userId-keyed AttendanceRecord every staff role already uses —
    // there is no student-specific attendance model, and none is needed.
    const records = await tx.attendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId },
      select: { status: true },
    });
    if (records.length === 0) return 0;
    const present = records.filter((r) => r.status === "present" || r.status === "late").length;
    return Math.round((present / records.length) * 100);
  },
};
