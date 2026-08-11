import { collapsePermissions } from "../../rbac/permission-collapse";
import { coursesWhere, teacherOwnedCourseIds, coursesListDataSource, courseDetailDataSource } from "./courses.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("coursesWhere", () => {
  it("returns null for an actor with no course:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await coursesWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await coursesWhere(tx, context(["course:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("collapses own/team/department/department-subtree to 'courses I teach'", async () => {
    const tx = {} as unknown as PrismaTx;
    for (const scope of ["own", "team", "department", "department-subtree"]) {
      const where = await coursesWhere(tx, context([`course:read:${scope}`]));
      expect(where).toEqual({ tenantId: "t1", deletedAt: null, teacherId: "u1" });
    }
  });

  it("layers an extra where clause on top of the scope condition", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await coursesWhere(tx, context(["course:read:tenant"]), { status: "active" });
    expect(where).toMatchObject({ status: "active" });
  });
});

describe("teacherOwnedCourseIds", () => {
  it("queries by direct teacherId ownership, never by delegating to coursesWhere's own tenant-wide branch", async () => {
    // Regression guard for the single most important distinction in this
    // domain (see this function's own doc comment): even an actor holding
    // course:read:tenant (which would make coursesWhere return every course
    // in the tenant) must only get back courses they actually teach here.
    const findMany = jest.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    const tx = { course: { findMany } } as unknown as PrismaTx;

    const ids = await teacherOwnedCourseIds(tx, { tenantId: "t1", userId: "u1" });
    expect(ids).toEqual(["c1", "c2"]);
    expect(findMany.mock.calls[0]![0].where).toEqual({ tenantId: "t1", teacherId: "u1", deletedAt: null });
  });

  it("accepts an explicit teacherId override, independent of ctx.userId", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { course: { findMany } } as unknown as PrismaTx;

    await teacherOwnedCourseIds(tx, { tenantId: "t1", userId: "u1" }, "other-teacher");
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ teacherId: "other-teacher" });
  });
});

describe("courses.list", () => {
  it("returns [] when the actor has no course:read grant", async () => {
    const tx = { course: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await coursesListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });

  it("joins teacherName and enrolledCount", async () => {
    const tx = {
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1", teacherId: "t1u" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "t1u", displayName: "Ms. Smith" }]) },
      enrollment: { groupBy: jest.fn().mockResolvedValue([{ courseId: "c1", _count: { courseId: 3 } }]) },
    } as unknown as PrismaTx;

    const rows = (await coursesListDataSource.resolve({}, context(["course:read:tenant"]), tx)) as {
      id: string;
      teacherName: string | null;
      enrolledCount: number;
    }[];
    expect(rows).toEqual([{ id: "c1", teacherId: "t1u", teacherName: "Ms. Smith", enrolledCount: 3 }]);
  });
});

describe("courses.detail", () => {
  it("throws NotFoundException for a course that doesn't exist or is out of scope", async () => {
    const tx = { course: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(courseDetailDataSource.resolve({ id: "ghost" }, context(["course:read:tenant"]), tx)).rejects.toThrow("No course");
  });

  it("computes the roster ungated by enrollment:read — visibility rides on reaching course:read alone", async () => {
    const tx = {
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", teacherId: null, materialsProjectId: "proj1" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: {
        findMany: jest.fn().mockResolvedValue([{ id: "e1", studentId: "s1", status: "enrolled", finalGrade: null }]),
      },
      student: { findMany: jest.fn().mockResolvedValue([{ id: "s1", name: "Jane" }]) },
      assignment: { count: jest.fn().mockResolvedValue(2) },
      document: { count: jest.fn().mockResolvedValue(1) },
    } as unknown as PrismaTx;

    // Teacher-shaped grant set: NO enrollment:read at all.
    const data = (await courseDetailDataSource.resolve(
      { id: "c1" },
      context(["course:read:tenant", "assignment:read:own", "document:create:tenant"]),
      tx,
    )) as { roster: { studentName: string }[] };
    expect(data.roster).toEqual([{ enrollmentId: "e1", studentId: "s1", studentName: "Jane", status: "enrolled", finalGrade: null }]);
  });

  function detailTx(overrides: Partial<{ projectFindFirst: jest.Mock }> = {}) {
    return {
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", teacherId: null, materialsProjectId: "proj1" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findMany: jest.fn().mockResolvedValue([]) },
      student: { findMany: jest.fn().mockResolvedValue([]) },
      assignment: { count: jest.fn().mockResolvedValue(0) },
      document: { count: jest.fn().mockResolvedValue(0) },
      project: { findFirst: overrides.projectFindFirst ?? jest.fn() },
    } as unknown as PrismaTx;
  }

  describe("materialsVisible", () => {
    // course:read and project:read are different permissions — a course
    // being visible does NOT mean its materials Project is. Mirrors
    // patients.data-sources.spec.ts's own withChartVisibility coverage.
    it("is true for an actor holding project:read:tenant (Admin/Teacher/TA-shaped)", async () => {
      const tx = detailTx({ projectFindFirst: jest.fn().mockResolvedValue({ id: "proj1" }) });
      const data = (await courseDetailDataSource.resolve(
        { id: "c1" },
        context(["course:read:tenant", "project:read:tenant"]),
        tx,
      )) as { materialsVisible: boolean };
      expect(data.materialsVisible).toBe(true);
    });

    it("is false for an actor with course:read but zero project:read at all (Registrar-shaped)", async () => {
      const tx = detailTx();
      const data = (await courseDetailDataSource.resolve({ id: "c1" }, context(["course:read:tenant", "enrollment:read:tenant"]), tx)) as {
        materialsVisible: boolean;
      };
      expect(data.materialsVisible).toBe(false);
      expect((tx as unknown as { project: { findFirst: jest.Mock } }).project.findFirst).not.toHaveBeenCalled();
    });

    it("is false when project:read is held but doesn't actually reach this course's own materials project", async () => {
      // e.g. project:read:own held by someone who doesn't own proj1.
      const tx = detailTx({ projectFindFirst: jest.fn().mockResolvedValue(null) });
      const data = (await courseDetailDataSource.resolve({ id: "c1" }, context(["course:read:tenant", "project:read:own"]), tx)) as {
        materialsVisible: boolean;
      };
      expect(data.materialsVisible).toBe(false);
    });
  });
});
