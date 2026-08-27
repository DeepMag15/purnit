import { collapsePermissions } from "../../rbac/permission-collapse";
import { assignmentsWhere, assignmentsListDataSource } from "./assignments.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("assignmentsWhere", () => {
  it("returns null for an actor with no assignment:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await assignmentsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope (Teaching Assistant)", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await assignmentsWhere(tx, context(["assignment:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("narrows to teacherOwnedCourseIds at own scope (Teacher) — this branch is genuinely live, not defensive", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    const tx = { course: { findMany } } as unknown as PrismaTx;

    const where = await assignmentsWhere(tx, context(["assignment:read:own"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, courseId: { in: ["c1", "c2"] } });
    expect(findMany.mock.calls[0]![0].where).toEqual({ tenantId: "t1", teacherId: "u1", deletedAt: null });
  });
});

describe("assignments.list", () => {
  it("requires assignment:read and folds courseId into the scope where", async () => {
    expect(assignmentsListDataSource.requiredPermission).toBe("assignment:read");
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { assignment: { findMany } } as unknown as PrismaTx;

    await assignmentsListDataSource.resolve({ courseId: "c1" }, context(["assignment:read:tenant"]), tx);
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ courseId: "c1" });
  });
});
