import { collapsePermissions } from "../../rbac/permission-collapse";
import { gradesWhere, gradesListDataSource } from "./grades.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("gradesWhere", () => {
  it("returns null for an actor with no grade:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await gradesWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope (Teaching Assistant)", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await gradesWhere(tx, context(["grade:read:tenant"]))).toEqual({ tenantId: "t1" });
  });

  it("walks the full Course -> Assignment -> Grade chain at own scope (Teacher) — gradedById is never consulted here", async () => {
    const courseFindMany = jest.fn().mockResolvedValue([{ id: "c1" }]);
    const assignmentFindMany = jest.fn().mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    const tx = { course: { findMany: courseFindMany }, assignment: { findMany: assignmentFindMany } } as unknown as PrismaTx;

    const where = await gradesWhere(tx, context(["grade:read:own"]));
    expect(where).toEqual({ tenantId: "t1", assignmentId: { in: ["a1", "a2"] } });
    expect(courseFindMany.mock.calls[0]![0].where).toEqual({ tenantId: "t1", teacherId: "u1", deletedAt: null });
    expect(assignmentFindMany.mock.calls[0]![0].where).toMatchObject({ courseId: { in: ["c1"] } });
  });
});

describe("grades.list", () => {
  it("returns [] when the target assignment is out of scope", async () => {
    const tx = { assignment: { findFirst: jest.fn() } } as unknown as PrismaTx;
    const rows = await gradesListDataSource.resolve({ assignmentId: "a1" }, context([]), tx);
    expect(rows).toEqual([]);
  });

  it("left-joins Enrollment so an ungraded student still appears, with gradeId: null", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1" }) },
      enrollment: {
        findMany: jest.fn().mockResolvedValue([
          { studentId: "s1", courseId: "c1", status: "enrolled" },
          { studentId: "s2", courseId: "c1", status: "enrolled" },
        ]),
      },
      student: {
        findMany: jest.fn().mockResolvedValue([
          { id: "s1", name: "Jane" },
          { id: "s2", name: "Bob" },
        ]),
      },
      grade: { findMany: jest.fn().mockResolvedValue([{ id: "g1", studentId: "s1", score: 90, feedback: null, gradedById: "teach1", gradedAt: "2026-01-01" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "teach1", displayName: "Ms. Smith" }]) },
    } as unknown as PrismaTx;

    const rows = await gradesListDataSource.resolve({ assignmentId: "a1" }, context(["grade:read:tenant", "assignment:read:tenant"]), tx);
    expect(rows).toEqual([
      { studentId: "s1", studentName: "Jane", gradeId: "g1", score: 90, feedback: null, gradedByName: "Ms. Smith", gradedAt: "2026-01-01" },
      { studentId: "s2", studentName: "Bob", gradeId: null, score: null, feedback: null, gradedByName: null, gradedAt: null },
    ]);
  });
});
