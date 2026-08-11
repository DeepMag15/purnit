import { collapsePermissions } from "../../rbac/permission-collapse";
import { studentsWhere, studentsListDataSource, studentDetailDataSource } from "./students.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("studentsWhere", () => {
  it("returns null for an actor with no student:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await studentsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await studentsWhere(tx, context(["student:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("collapses own/team/department/department-subtree to 'students I registered'", async () => {
    const tx = {} as unknown as PrismaTx;
    for (const scope of ["own", "team", "department", "department-subtree"]) {
      const where = await studentsWhere(tx, context([`student:read:${scope}`]));
      expect(where).toEqual({ tenantId: "t1", deletedAt: null, registeredById: "u1" });
    }
  });

  it("layers an extra where clause on top of the scope condition", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await studentsWhere(tx, context(["student:read:tenant"]), { status: "active" });
    expect(where).toMatchObject({ status: "active" });
  });
});

describe("students.list", () => {
  it("returns [] when the actor has no student:read grant", async () => {
    const tx = { student: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await studentsListDataSource.resolve({}, context([]), tx)).toEqual([]);
    expect((tx as unknown as { student: { findMany: jest.Mock } }).student.findMany).not.toHaveBeenCalled();
  });

  it("enriches each student with activeEnrollmentCount via groupBy", async () => {
    const tx = {
      student: { findMany: jest.fn().mockResolvedValue([{ id: "s1" }, { id: "s2" }]) },
      enrollment: { groupBy: jest.fn().mockResolvedValue([{ studentId: "s1", _count: { studentId: 2 } }]) },
    } as unknown as PrismaTx;

    const rows = (await studentsListDataSource.resolve({}, context(["student:read:tenant"]), tx)) as { id: string; activeEnrollmentCount: number }[];
    expect(rows).toEqual([
      { id: "s1", activeEnrollmentCount: 2 },
      { id: "s2", activeEnrollmentCount: 0 },
    ]);
  });
});

describe("students.detail", () => {
  it("throws NotFoundException for a student that doesn't exist or is out of scope", async () => {
    const tx = { student: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(studentDetailDataSource.resolve({ id: "ghost" }, context(["student:read:tenant"]), tx)).rejects.toThrow("No student");
  });

  it("populates enrollments only when the actor holds enrollment:read (Teacher does not)", async () => {
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: "s1", name: "Jane" }) },
      enrollment: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    const data = (await studentDetailDataSource.resolve({ id: "s1" }, context(["student:read:tenant"]), tx)) as {
      canReadEnrollments: boolean;
      enrollments: unknown[];
    };
    expect(data.canReadEnrollments).toBe(false);
    expect(data.enrollments).toEqual([]);
    expect((tx as unknown as { enrollment: { findMany: jest.Mock } }).enrollment.findMany).not.toHaveBeenCalled();
  });

  it("returns the student's enrollments with course names when the actor holds enrollment:read", async () => {
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: "s1", name: "Jane" }) },
      enrollment: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "e1", courseId: "c1", status: "enrolled", finalGrade: null, course: { id: "c1", name: "Algebra" } }]),
      },
    } as unknown as PrismaTx;

    const data = (await studentDetailDataSource.resolve(
      { id: "s1" },
      context(["student:read:tenant", "enrollment:read:tenant"]),
      tx,
    )) as { canReadEnrollments: boolean; enrollments: { courseName: string }[] };
    expect(data.canReadEnrollments).toBe(true);
    expect(data.enrollments).toEqual([{ id: "e1", courseId: "c1", courseName: "Algebra", status: "enrolled", finalGrade: null }]);
  });
});
