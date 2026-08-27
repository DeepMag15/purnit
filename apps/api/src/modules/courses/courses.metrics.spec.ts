import { collapsePermissions } from "../../rbac/permission-collapse";
import { coursesActiveCountMetric, teachersActiveCountMetric } from "./courses.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("courses metrics", () => {
  it("coursesActiveCountMetric requires course:read", () => {
    expect(coursesActiveCountMetric.requiredPermission).toBe("course:read");
  });

  it("coursesActiveCountMetric.computeLive filters on status: active via coursesWhere", async () => {
    const tx = { course: { count: jest.fn().mockResolvedValue(3) } } as unknown as PrismaTx;
    const value = await coursesActiveCountMetric.computeLive(context(["course:read:tenant"]), tx);
    expect(value).toBe(3);
    const call = (tx as unknown as { course: { count: jest.Mock } }).course.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", status: "active" });
  });

  it("coursesActiveCountMetric.computeLive returns 0 with no course:read grant", async () => {
    const tx = { course: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await coursesActiveCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { course: { count: jest.Mock } }).course.count).not.toHaveBeenCalled();
  });

  describe("teachersActiveCountMetric", () => {
    it("requires course:read", () => {
      expect(teachersActiveCountMetric.requiredPermission).toBe("course:read");
    });

    it("returns 0 and never queries when the actor has no course:read grant at all", async () => {
      const tx = { roleAssignment: { findMany: jest.fn() }, user: { count: jest.fn() } } as unknown as PrismaTx;
      expect(await teachersActiveCountMetric.computeLive(context([]), tx)).toBe(0);
      expect((tx as unknown as { roleAssignment: { findMany: jest.Mock } }).roleAssignment.findMany).not.toHaveBeenCalled();
    });

    it("joins role assignments by sourceBlueprintRoleId=role.teacher, dedupes users, counts active ones", async () => {
      const tx = {
        roleAssignment: { findMany: jest.fn().mockResolvedValue([{ userId: "t1" }, { userId: "t2" }, { userId: "t1" }]) },
        user: { count: jest.fn().mockResolvedValue(2) },
      } as unknown as PrismaTx;

      const value = await teachersActiveCountMetric.computeLive(context(["course:read:tenant"]), tx);
      expect(value).toBe(2);

      const findManyCall = (tx as unknown as { roleAssignment: { findMany: jest.Mock } }).roleAssignment.findMany.mock.calls[0][0];
      expect(findManyCall.where).toMatchObject({ tenantId: "t1", role: { sourceBlueprintRoleId: "role.teacher" } });

      const countCall = (tx as unknown as { user: { count: jest.Mock } }).user.count.mock.calls[0][0];
      expect(countCall.where).toMatchObject({ id: { in: ["t1", "t2"] }, tenantId: "t1", status: "active", deletedAt: null });
    });

    it("returns 0 without querying User when no role.teacher assignments exist", async () => {
      const tx = {
        roleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        user: { count: jest.fn() },
      } as unknown as PrismaTx;
      expect(await teachersActiveCountMetric.computeLive(context(["course:read:tenant"]), tx)).toBe(0);
      expect((tx as unknown as { user: { count: jest.Mock } }).user.count).not.toHaveBeenCalled();
    });
  });
});
