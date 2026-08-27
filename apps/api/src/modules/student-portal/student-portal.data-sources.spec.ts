import { ForbiddenException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  requireOwnStudent,
  myCoursesListDataSource,
  myAssignmentsListDataSource,
  myProgressGetDataSource,
  studentPortalCapabilitiesDataSource,
} from "./student-portal.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = ["studentPortal:read:own"], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

const DAY = 24 * 3600 * 1000;
const linkedStudent = { id: "s1", name: "Ada", userId: "u1" };

/** Every source here starts by resolving the caller's own Student row, so a
 * tx fake needs it before anything else is exercised. */
function txWith(over: Record<string, unknown> = {}, student: unknown = linkedStudent) {
  return {
    student: { findFirst: jest.fn().mockResolvedValue(student) },
    enrollment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    course: { findMany: jest.fn().mockResolvedValue([]) },
    assignment: { findMany: jest.fn().mockResolvedValue([]) },
    grade: { findMany: jest.fn().mockResolvedValue([]) },
    // Documents module review — a student's own submission tasks. Empty by
    // default: most assignments have none, since a task is created lazily on
    // the first hand-in rather than fanned out at assignment-creation time.
    task: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  } as unknown as PrismaTx;
}

describe("requireOwnStudent", () => {
  it("resolves the student by the SIGNED-IN user, never by a parameter", async () => {
    const tx = txWith();
    await requireOwnStudent(tx, context());
    // The security property of the whole portal: whose data is returned is
    // decided by ctx.userId server-side, so there is no id to tamper with.
    expect((tx as unknown as { student: { findFirst: jest.Mock } }).student.findFirst).toHaveBeenCalledWith({
      where: { tenantId: "t1", userId: "u1", deletedAt: null },
    });
  });

  it("throws a specific, actionable refusal when the login isn't linked", async () => {
    const tx = txWith({}, null);
    // Deliberately not an empty result: "it's blank" sends a student to the
    // school office with nothing anyone can act on.
    await expect(requireOwnStudent(tx, context())).rejects.toThrow(ForbiddenException);
    await expect(requireOwnStudent(tx, context())).rejects.toThrow(/isn't linked to a student record/);
  });
});

describe("myCourses.list", () => {
  it("returns [] for a student with no enrolments, without querying courses", async () => {
    const tx = txWith();
    expect(await myCoursesListDataSource.resolve({}, context(), tx)).toEqual([]);
    expect((tx as unknown as { course: { findMany: jest.Mock } }).course.findMany).not.toHaveBeenCalled();
  });

  it("scopes every query to the caller's own studentId", async () => {
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled", finalGrade: null }]) },
      course: {
        findMany: jest.fn().mockResolvedValue([
          { id: "c1", name: "Maths", description: null, teacherId: null, materialsProjectId: "p1" },
        ]),
      },
    });
    await myCoursesListDataSource.resolve({}, context(), tx);

    const enrolment = (tx as unknown as { enrollment: { findMany: jest.Mock } }).enrollment.findMany.mock.calls[0][0];
    expect(enrolment.where).toMatchObject({ tenantId: "t1", studentId: "s1" });
    const grades = (tx as unknown as { grade: { findMany: jest.Mock } }).grade.findMany.mock.calls[0][0];
    expect(grades.where).toMatchObject({ tenantId: "t1", studentId: "s1" });
  });

  it("counts an assignment as outstanding until it is graded, and surfaces the next real deadline", async () => {
    const soon = new Date(Date.now() + 2 * DAY);
    const past = new Date(Date.now() - 2 * DAY);
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled", finalGrade: null }]) },
      course: {
        findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths", description: null, teacherId: null, materialsProjectId: "p1" }]),
      },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a1", courseId: "c1", dueDate: past }, // graded below
          { id: "a2", courseId: "c1", dueDate: soon },
        ]),
      },
      grade: { findMany: jest.fn().mockResolvedValue([{ assignmentId: "a1", score: 80 }]) },
    });

    const [row] = (await myCoursesListDataSource.resolve({}, context(), tx)) as { outstandingCount: number; nextDueDate: Date | null }[];
    expect(row.outstandingCount).toBe(1);
    // A deadline already past is not "next" — the card would otherwise tell a
    // student their next deadline was last week.
    expect(row.nextDueDate).toEqual(soon);
  });
});

describe("myAssignments.list", () => {
  it("only returns assignments from courses the student is enrolled in", async () => {
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled" }]) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
      assignment: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await myAssignmentsListDataSource.resolve({}, context(), tx);

    const call = (tx as unknown as { assignment: { findMany: jest.Mock } }).assignment.findMany.mock.calls[0][0];
    expect(call.where.courseId).toEqual({ in: ["c1"] });
  });

  it("marks ungraded past-due work overdue, and never marks graded work overdue", async () => {
    const past = new Date(Date.now() - 3 * DAY);
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled" }]) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a1", title: "Late", description: null, courseId: "c1", dueDate: past, maxScore: 100 },
          { id: "a2", title: "Done", description: null, courseId: "c1", dueDate: past, maxScore: 100 },
        ]),
      },
      grade: { findMany: jest.fn().mockResolvedValue([{ assignmentId: "a2", score: 70, feedback: "ok" }]) },
    });

    const rows = (await myAssignmentsListDataSource.resolve({}, context(), tx)) as { id: string; overdue: boolean; graded: boolean; score: number | null }[];
    expect(rows.find((r) => r.id === "a1")).toMatchObject({ overdue: true, graded: false, score: null });
    // Graded work is finished regardless of when it was due.
    expect(rows.find((r) => r.id === "a2")).toMatchObject({ overdue: false, graded: true, score: 70 });
  });

  it("treats a grade row with a null score as not yet graded", async () => {
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled" }]) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
      assignment: {
        findMany: jest.fn().mockResolvedValue([{ id: "a1", title: "X", description: null, courseId: "c1", dueDate: null, maxScore: 100 }]),
      },
      // A Grade row can exist with no score — created but not yet marked.
      grade: { findMany: jest.fn().mockResolvedValue([{ assignmentId: "a1", score: null, feedback: null }]) },
    });
    const [row] = (await myAssignmentsListDataSource.resolve({}, context(), tx)) as { graded: boolean }[];
    expect(row.graded).toBe(false);
  });

  /**
   * Documents module review — handing work in and being graded are two
   * different questions, and this source is the only place they meet.
   *
   * `submissionStatus` is derived from the submission task's own status
   * rather than stored a second time, so these pin the derivation: a task
   * that has been submitted and handed back sits at `in_progress` with a
   * `submittedAt` already set, which is the only thing distinguishing it
   * from work never handed in.
   */
  describe("submissionStatus", () => {
    const assignment = { id: "a1", title: "Essay", description: null, courseId: "c1", dueDate: null, maxScore: 100 };
    async function withTask(task: Record<string, unknown> | null) {
      const tx = txWith({
        enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled" }]) },
        course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
        assignment: { findMany: jest.fn().mockResolvedValue([assignment]) },
        task: { findMany: jest.fn().mockResolvedValue(task ? [{ assignmentId: "a1", documents: [], ...task }] : []) },
      });
      const [row] = (await myAssignmentsListDataSource.resolve({}, context(), tx)) as Record<string, unknown>[];
      return row;
    }

    it("reads not_submitted when the student has no submission task at all", async () => {
      expect(await withTask(null)).toMatchObject({ submissionStatus: "not_submitted", submissionTaskId: null });
    });

    it("reads submitted while it sits in the teacher's queue", async () => {
      expect(await withTask({ id: "tk1", status: "in_review", submittedAt: new Date(), reviewNote: null })).toMatchObject({
        submissionStatus: "submitted",
        submissionTaskId: "tk1",
      });
    });

    it("reads changes_requested once a teacher hands it back, and carries their note", async () => {
      expect(
        await withTask({ id: "tk1", status: "in_progress", submittedAt: new Date(), reviewNote: "Show your working." }),
      ).toMatchObject({ submissionStatus: "changes_requested", teacherNote: "Show your working." });
    });

    it("reads accepted once the teacher approves it", async () => {
      expect(await withTask({ id: "tk1", status: "done", submittedAt: new Date(), reviewNote: null })).toMatchObject({
        submissionStatus: "accepted",
      });
    });

    it("reads not_submitted for a task that exists but was never handed in", async () => {
      expect(await withTask({ id: "tk1", status: "todo", submittedAt: null, reviewNote: null })).toMatchObject({
        submissionStatus: "not_submitted",
      });
    });

    // Chasing a student for work already sitting in the teacher's queue is
    // just wrong — overdue means neither graded nor handed in.
    it("does not mark handed-in work overdue", async () => {
      const past = new Date(Date.now() - 3 * DAY);
      const tx = txWith({
        enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled" }]) },
        course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
        assignment: { findMany: jest.fn().mockResolvedValue([{ ...assignment, dueDate: past }]) },
        task: {
          findMany: jest.fn().mockResolvedValue([{ id: "tk1", assignmentId: "a1", status: "in_review", submittedAt: past, reviewNote: null, documents: [] }]),
        },
      });
      const [row] = (await myAssignmentsListDataSource.resolve({}, context(), tx)) as { overdue: boolean }[];
      expect(row.overdue).toBe(false);
    });
  });
});

describe("myProgress.get", () => {
  it("averages over graded work only", async () => {
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled", finalGrade: null }]) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a1", courseId: "c1", maxScore: 100 },
          { id: "a2", courseId: "c1", maxScore: 100 }, // not graded
        ]),
      },
      grade: { findMany: jest.fn().mockResolvedValue([{ assignmentId: "a1", score: 90 }]) },
    });

    const result = (await myProgressGetDataSource.resolve({}, context(), tx)) as { overallPercent: number | null; perCourse: { averagePercent: number | null }[] };
    // 90/100 over graded work, NOT 90/200 — counting ungraded assignments as
    // zero would show a student failing a course they are early in.
    expect(result.overallPercent).toBe(90);
    expect(result.perCourse[0].averagePercent).toBe(90);
  });

  it("reports null rather than 0% when nothing has been graded yet", async () => {
    const tx = txWith({
      enrollment: { findMany: jest.fn().mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled", finalGrade: null }]) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Maths" }]) },
      assignment: { findMany: jest.fn().mockResolvedValue([{ id: "a1", courseId: "c1", maxScore: 100 }]) },
    });
    const result = (await myProgressGetDataSource.resolve({}, context(), tx)) as { overallPercent: number | null };
    expect(result.overallPercent).toBeNull();
  });

  it("reads attendance by the signed-in user, counting late as attended", async () => {
    const tx = txWith({
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "present" }]),
      },
    });
    const result = (await myProgressGetDataSource.resolve({}, context(), tx)) as { attendancePercent: number | null };
    expect(result.attendancePercent).toBe(75);

    const call = (tx as unknown as { attendanceRecord: { findMany: jest.Mock } }).attendanceRecord.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", userId: "u1" });
  });
});

describe("studentPortal.capabilities", () => {
  it("distinguishes a linked student from an unlinked one without failing", async () => {
    const linked = await studentPortalCapabilitiesDataSource.resolve({}, context(), txWith());
    expect(linked).toEqual({ isStudent: true, isLinked: true, studentName: "Ada" });

    const unlinked = await studentPortalCapabilitiesDataSource.resolve({}, context(), txWith({}, null));
    expect(unlinked).toMatchObject({ isStudent: true, isLinked: false });
  });

  it("reports isStudent false for a staff role", async () => {
    const result = (await studentPortalCapabilitiesDataSource.resolve({}, context(["course:read:tenant"]), txWith({}, null))) as { isStudent: boolean };
    expect(result.isStudent).toBe(false);
  });
});
