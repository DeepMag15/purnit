import { collapsePermissions } from "../../rbac/permission-collapse";
import { projectsActiveCountMetric, projectsStatusBreakdownMetric } from "./projects.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("projects metrics", () => {
  it("projectsActiveCountMetric requires project:read", () => {
    expect(projectsActiveCountMetric.requiredPermission).toBe("project:read");
  });

  it("projectsActiveCountMetric.computeLive calls through projectsWhere with status: active", async () => {
    const tx = { project: { count: jest.fn().mockResolvedValue(3) } } as unknown as PrismaTx;
    const value = await projectsActiveCountMetric.computeLive(context(["project:read:tenant"]), tx);
    expect(value).toBe(3);
    const call = (tx as unknown as { project: { count: jest.Mock } }).project.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", status: "active" });
  });

  it("projectsActiveCountMetric.computeLive returns 0 when the actor has no project:read grant at all", async () => {
    const tx = { project: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await projectsActiveCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { project: { count: jest.Mock } }).project.count).not.toHaveBeenCalled();
  });

  it("projectsStatusBreakdownMetric requires project:read and has no snapshot", () => {
    expect(projectsStatusBreakdownMetric.requiredPermission).toBe("project:read");
    expect(projectsStatusBreakdownMetric.kind).toBe("breakdown");
  });

  it("projectsStatusBreakdownMetric.computeLive maps groupBy results to {status, count}", async () => {
    const tx = {
      project: { groupBy: jest.fn().mockResolvedValue([{ status: "active", _count: { _all: 2 } }]) },
    } as unknown as PrismaTx;
    const rows = await projectsStatusBreakdownMetric.computeLive(context(["project:read:tenant"]), tx);
    expect(rows).toEqual([{ status: "active", count: 2 }]);
  });

  it("projectsActiveCountMetric.computeLive layers a departmentId filter onto projectsWhere's own scope condition", async () => {
    const tx = { project: { count: jest.fn().mockResolvedValue(1) } } as unknown as PrismaTx;
    await projectsActiveCountMetric.computeLive(context(["project:read:tenant"]), tx, { departmentId: "d1" });
    const call = (tx as unknown as { project: { count: jest.Mock } }).project.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ status: "active", departmentId: "d1" });
  });
});
