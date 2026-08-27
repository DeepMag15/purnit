import { z } from "zod";
import { ForbiddenException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/**
 * Student Role — the learner's own view of their own record.
 *
 * Every source here is **ownership-scoped, not permission-scoped**, and none
 * takes an id identifying whose data to return. `requireOwnStudent` resolves
 * the caller's Student row from `ctx.userId` and everything hangs off that, so
 * there is no parameter to tamper with: a student cannot ask for another
 * student's courses because the request has nowhere to say whose.
 *
 * That is why the role holds no `student:read` / `enrollment:read` /
 * `grade:read` grant at all. Those are tenant-scoped staff permissions — a
 * student granted `enrollment:read:tenant` would see the whole school's
 * enrolments. The role's single `studentPortal:read` gates the *surface*; the
 * data is bounded here, one layer deeper, exactly as
 * `account.export`/`notifications.list` already work (ARCHITECTURE.md §15.1,
 * rule 4).
 */

/**
 * The caller's own Student row.
 *
 * Throws rather than returning null: reaching any of these sources means the
 * blueprint already granted `studentPortal:read`, so a missing link is a
 * provisioning mistake — a Student login that was never bound to a record —
 * and a silent empty page would send the student to support with "it's blank"
 * instead of something actionable.
 */
export async function requireOwnStudent(tx: PrismaTx, ctx: DataSourceContext) {
  const student = await tx.student.findFirst({
    where: { tenantId: ctx.tenantId, userId: ctx.userId, deletedAt: null },
  });
  if (!student) {
    throw new ForbiddenException(
      "This login isn't linked to a student record yet. Ask your school administrator to connect it.",
    );
  }
  return student;
}

/** Enrolments that actually put a student in a class right now. A dropped
 * enrolment is history, not a course they are taking. */
const ACTIVE_ENROLMENT_STATUSES = ["enrolled", "completed"];

async function myEnrolments(tx: PrismaTx, ctx: DataSourceContext, studentId: string) {
  return tx.enrollment.findMany({
    where: { tenantId: ctx.tenantId, studentId, status: { in: ACTIVE_ENROLMENT_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

const EmptyParamsSchema = z.object({});

// ---------------------------------------------------------------------------
// myCourses.list
// ---------------------------------------------------------------------------
export const myCoursesListDataSource: DataSourceDefinition<z.infer<typeof EmptyParamsSchema>> = {
  name: "myCourses.list",
  paramsSchema: EmptyParamsSchema,
  async resolve(_params, ctx, tx) {
    const student = await requireOwnStudent(tx, ctx);
    const enrolments = await myEnrolments(tx, ctx, student.id);
    if (enrolments.length === 0) return [];

    // Sequential, not Promise.all — same shared-tx rule as every other
    // multi-query resolver in this codebase (CONTEXT.md §9).
    const courses = await tx.course.findMany({
      where: { id: { in: enrolments.map((e) => e.courseId) }, tenantId: ctx.tenantId, deletedAt: null },
    });
    const teacherIds = [...new Set(courses.map((c) => c.teacherId).filter((id): id is string => !!id))];
    const teachers = teacherIds.length
      ? await tx.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, displayName: true } })
      : [];
    const teacherName = new Map(teachers.map((t) => [t.id, t.displayName]));

    const assignments = await tx.assignment.findMany({
      where: { tenantId: ctx.tenantId, courseId: { in: courses.map((c) => c.id) }, deletedAt: null },
      select: { id: true, courseId: true, dueDate: true },
    });
    const grades = await tx.grade.findMany({
      where: { tenantId: ctx.tenantId, studentId: student.id },
      select: { assignmentId: true, score: true },
    });
    const gradedIds = new Set(grades.filter((g) => g.score !== null).map((g) => g.assignmentId));

    const now = new Date();
    const byCourse = new Map(courses.map((c) => [c.id, c]));

    return enrolments
      .filter((e) => byCourse.has(e.courseId))
      .map((e) => {
        const course = byCourse.get(e.courseId)!;
        const mine = assignments.filter((a) => a.courseId === course.id);
        const outstanding = mine.filter((a) => !gradedIds.has(a.id));
        // The next thing actually due — the single most useful number on a
        // course card, and the reason this source does the work rather than
        // making the client stitch three lists together.
        const nextDue = outstanding
          .map((a) => a.dueDate)
          .filter((d): d is Date => !!d && d >= now)
          .sort((a, b) => a.getTime() - b.getTime())[0];

        return {
          enrollmentId: e.id,
          courseId: course.id,
          name: course.name,
          description: course.description,
          teacherName: course.teacherId ? (teacherName.get(course.teacherId) ?? null) : null,
          enrolmentStatus: e.status,
          finalGrade: e.finalGrade,
          assignmentCount: mine.length,
          outstandingCount: outstanding.length,
          nextDueDate: nextDue ?? null,
          // Course materials live in the Course's own materialsProject. A
          // Student *User* can be a real ProjectMember of it, which is what
          // `Student.userId` unlocked — so the existing documents module
          // serves them with no student-specific code.
          materialsProjectId: course.materialsProjectId,
          // Where this student submits work for this course. Owned by them,
          // so the ordinary document upload path works with no extra grant.
          submissionsProjectId: e.submissionsProjectId,
        };
      });
  },
};

// ---------------------------------------------------------------------------
// myAssignments.list
// ---------------------------------------------------------------------------
/**
 * A student's own assignments, each with where their work has got to.
 *
 * ⚠️ This comment used to say "this platform has no student submission model
 * … deliberately out of scope for the Student role", written when that was
 * true. It stopped being true in two halves that never met: Contextual
 * Reporting gave every enrollment a `submissionsProjectId`, and the
 * restricted-projects fix hardened it specifically to protect a student's
 * private work — while the portal still had no way to put anything in it.
 * The Documents review closed that (see `submissions.mutations.ts`).
 *
 * Two different states are now reported, and they are genuinely different
 * questions: **has the student handed it in** (their own submission task) and
 * **has the teacher graded it** (a Grade row). Work can be submitted and
 * ungraded, graded without a submission (marked from paper), or neither.
 */
export const myAssignmentsListDataSource: DataSourceDefinition<z.infer<typeof EmptyParamsSchema>> = {
  name: "myAssignments.list",
  paramsSchema: EmptyParamsSchema,
  async resolve(_params, ctx, tx) {
    const student = await requireOwnStudent(tx, ctx);
    const enrolments = await myEnrolments(tx, ctx, student.id);
    if (enrolments.length === 0) return [];

    const courseIds = enrolments.map((e) => e.courseId);
    const courses = await tx.course.findMany({
      where: { id: { in: courseIds }, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const courseName = new Map(courses.map((c) => [c.id, c.name]));

    const assignments = await tx.assignment.findMany({
      where: { tenantId: ctx.tenantId, courseId: { in: courses.map((c) => c.id) }, deletedAt: null },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });
    const grades = await tx.grade.findMany({
      where: { tenantId: ctx.tenantId, studentId: student.id, assignmentId: { in: assignments.map((a) => a.id) } },
    });
    const gradeFor = new Map(grades.map((g) => [g.assignmentId, g]));

    // The student's own submission tasks — created lazily on first submit, so
    // most assignments have none. Sequential, same shared-tx rule as every
    // other multi-query resolver here.
    const submissions = ctx.userId
      ? await tx.task.findMany({
          where: {
            tenantId: ctx.tenantId,
            assigneeId: ctx.userId,
            assignmentId: { in: assignments.map((a) => a.id) },
            deletedAt: null,
          },
          include: { documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { name: true, createdAt: true } } },
        })
      : [];
    const submissionFor = new Map(submissions.filter((t) => t.assignmentId).map((t) => [t.assignmentId, t]));

    const now = new Date();
    return assignments.map((a) => {
      const grade = gradeFor.get(a.id);
      const graded = !!grade && grade.score !== null;
      const submission = submissionFor.get(a.id);
      // "not_submitted" | "submitted" (waiting on the teacher) |
      // "changes_requested" (handed back) | "accepted". Derived from the task's
      // own status rather than stored twice.
      const submissionStatus = !submission
        ? "not_submitted"
        : submission.status === "in_review"
          ? "submitted"
          : submission.status === "done"
            ? "accepted"
            : submission.submittedAt
              ? "changes_requested"
              : "not_submitted";
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        courseId: a.courseId,
        courseName: courseName.get(a.courseId) ?? "Unknown course",
        dueDate: a.dueDate,
        maxScore: a.maxScore,
        graded,
        score: graded ? grade!.score : null,
        feedback: graded ? grade!.feedback : null,
        submissionStatus,
        submissionTaskId: submission?.id ?? null,
        submittedAt: submission?.submittedAt ?? null,
        submittedFileName: submission?.documents[0]?.name ?? null,
        // The teacher's note from `task.review` — what to fix, when work came
        // back. Shown to the student, so it must survive a resubmission clear.
        teacherNote: submission?.reviewNote ?? null,
        // Overdue only means something for work that is neither graded nor
        // handed in — chasing a student for work already sitting in the
        // teacher's queue is just wrong.
        overdue: !graded && submissionStatus === "not_submitted" && !!a.dueDate && a.dueDate < now,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// myProgress.get
// ---------------------------------------------------------------------------
export const myProgressGetDataSource: DataSourceDefinition<z.infer<typeof EmptyParamsSchema>> = {
  name: "myProgress.get",
  paramsSchema: EmptyParamsSchema,
  async resolve(_params, ctx, tx) {
    const student = await requireOwnStudent(tx, ctx);
    const enrolments = await myEnrolments(tx, ctx, student.id);

    const courses = enrolments.length
      ? await tx.course.findMany({
          where: { id: { in: enrolments.map((e) => e.courseId) }, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true, name: true },
        })
      : [];
    const assignments = courses.length
      ? await tx.assignment.findMany({
          where: { tenantId: ctx.tenantId, courseId: { in: courses.map((c) => c.id) }, deletedAt: null },
          select: { id: true, courseId: true, maxScore: true },
        })
      : [];
    const grades = await tx.grade.findMany({
      where: { tenantId: ctx.tenantId, studentId: student.id },
      select: { assignmentId: true, score: true },
    });
    const scoreFor = new Map(grades.filter((g) => g.score !== null).map((g) => [g.assignmentId, g.score!]));

    // Attendance is the same userId-keyed AttendanceRecord every staff role
    // already uses — no student-specific attendance model, and none needed.
    const attendance = await tx.attendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId },
      select: { status: true },
    });
    const present = attendance.filter((a) => a.status === "present" || a.status === "late").length;

    const enrolmentFor = new Map(enrolments.map((e) => [e.courseId, e]));
    const perCourse = courses.map((c) => {
      const mine = assignments.filter((a) => a.courseId === c.id);
      const scored = mine.filter((a) => scoreFor.has(a.id));
      const earned = scored.reduce((sum, a) => sum + (scoreFor.get(a.id) ?? 0), 0);
      const possible = scored.reduce((sum, a) => sum + a.maxScore, 0);
      return {
        courseId: c.id,
        courseName: c.name,
        assignmentCount: mine.length,
        gradedCount: scored.length,
        // Averaged over graded work only. Counting ungraded assignments as
        // zero would show a student failing a course they are simply early in.
        averagePercent: possible > 0 ? Math.round((earned / possible) * 100) : null,
        finalGrade: enrolmentFor.get(c.id)?.finalGrade ?? null,
        enrolmentStatus: enrolmentFor.get(c.id)?.status ?? "enrolled",
      };
    });

    const allScored = assignments.filter((a) => scoreFor.has(a.id));
    const totalEarned = allScored.reduce((sum, a) => sum + (scoreFor.get(a.id) ?? 0), 0);
    const totalPossible = allScored.reduce((sum, a) => sum + a.maxScore, 0);

    return {
      studentName: student.name,
      courseCount: courses.length,
      assignmentCount: assignments.length,
      gradedCount: allScored.length,
      overallPercent: totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : null,
      attendanceRecorded: attendance.length,
      attendancePercent: attendance.length > 0 ? Math.round((present / attendance.length) * 100) : null,
      perCourse,
    };
  },
};

// ---------------------------------------------------------------------------
// myCourseMaterials.list
// ---------------------------------------------------------------------------
/**
 * Course notes and resources, for the courses this student is enrolled in.
 *
 * ⚠️ This exists because reusing `documents.list` directly does **not** work
 * for a student, and the reason is worth recording — the Education blueprint
 * had already documented the same trap for Teachers and I walked into it
 * anyway.
 *
 * `documents.list` calls `assertProjectVisible`, which routes through
 * `projectsWhere`. At `own` scope that sets `ownerId = ctx.userId` and returns
 * immediately — **membership is never considered**. A course's materialsProject
 * is owned by whichever Admin ran `course.create`, so a student who is a
 * genuine `ProjectMember` is still refused. The next scope up (`team`) does
 * check membership, but ORs in `departmentId = ctx.userDepartmentId`, which
 * would show a student every project in their year group. Neither is right.
 *
 * So the boundary is drawn here instead, from enrolment: a student sees
 * materials for courses they are actually taking, and holds no `project:*`
 * grant at all. The `ProjectMember` rows enrolment writes are still what makes
 * the *documents themselves* legitimately theirs — this source just stops the
 * project-scope ladder from being the thing that decides.
 */
const MaterialsParamsSchema = z.object({ courseId: z.string().optional() });

export const myCourseMaterialsListDataSource: DataSourceDefinition<z.infer<typeof MaterialsParamsSchema>> = {
  name: "myCourseMaterials.list",
  paramsSchema: MaterialsParamsSchema,
  async resolve(params, ctx, tx) {
    const student = await requireOwnStudent(tx, ctx);
    const enrolments = await myEnrolments(tx, ctx, student.id);
    if (enrolments.length === 0) return [];

    // A courseId narrows the result, but only ever *within* what enrolment
    // already allows — asking for a course they are not enrolled in returns
    // nothing rather than refusing, since the id itself reveals nothing.
    const courseIds = params.courseId
      ? enrolments.filter((e) => e.courseId === params.courseId).map((e) => e.courseId)
      : enrolments.map((e) => e.courseId);
    if (courseIds.length === 0) return [];

    const courses = await tx.course.findMany({
      where: { id: { in: courseIds }, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, name: true, materialsProjectId: true },
    });
    if (courses.length === 0) return [];

    const documents = await tx.document.findMany({
      where: {
        tenantId: ctx.tenantId,
        projectId: { in: courses.map((c) => c.materialsProjectId) },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    const courseByProject = new Map(courses.map((c) => [c.materialsProjectId, c]));

    return documents.map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      courseId: courseByProject.get(d.projectId)?.id ?? null,
      courseName: courseByProject.get(d.projectId)?.name ?? null,
    }));
  },
};

/** Self-reporting probe, same shape as every other `*.capabilities` source —
 * lets the dashboard tell a linked student apart from an unlinked one without
 * a failing request. */
export const studentPortalCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof EmptyParamsSchema>> = {
  name: "studentPortal.capabilities",
  paramsSchema: EmptyParamsSchema,
  async resolve(_params, ctx, tx) {
    const student = await tx.student.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, deletedAt: null },
      select: { id: true, name: true },
    });
    return {
      isStudent: ctx.effective.has("studentPortal", "read") !== null,
      isLinked: !!student,
      studentName: student?.name ?? null,
    };
  },
};
