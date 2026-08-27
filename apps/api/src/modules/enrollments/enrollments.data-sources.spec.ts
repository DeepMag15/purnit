import { collapsePermissions } from "../../rbac/permission-collapse";
import { enrollmentsWhere, enrollmentsListDataSource } from "./enrollments.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("enrollmentsWhere", () => {
  it("returns null for an actor with no enrollment:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await enrollmentsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope, and collapses :own to 'enrollments I created'", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await enrollmentsWhere(tx, context(["enrollment:read:tenant"]))).toEqual({ tenantId: "t1" });
    expect(await enrollmentsWhere(tx, context(["enrollment:read:own"]))).toEqual({ tenantId: "t1", enrolledById: "u1" });
  });
});

describe("enrollments.list", () => {
  it("joins studentName and courseName", async () => {
    const tx = {
      enrollment: {
        findMany: jest.fn().mockResolvedValue([{ id: "e1", studentId: "s1", courseId: "c1", status: "enrolled", finalGrade: null, course: { id: "c1", name: "Algebra" } }]),
      },
      student: { findMany: jest.fn().mockResolvedValue([{ id: "s1", name: "Jane" }]) },
    } as unknown as PrismaTx;

    const rows = await enrollmentsListDataSource.resolve({}, context(["enrollment:read:tenant"]), tx);
    expect(rows).toEqual([{ id: "e1", studentId: "s1", studentName: "Jane", courseId: "c1", courseName: "Algebra", status: "enrolled", finalGrade: null }]);
  });
});
