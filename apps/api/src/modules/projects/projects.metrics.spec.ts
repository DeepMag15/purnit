import { collapsePermissions } from "../../rbac/permission-collapse";
import { projectsActiveCountMetric, projectsStatusBreakdownMetric, projectsAtRiskMetric } from "./projects.metrics";
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

  describe("projectsAtRiskMetric (Phase F)", () => {
    it("requires project:read and has no snapshot", () => {
      expect(projectsAtRiskMetric.requiredPermission).toBe("project:read");
      expect(projectsAtRiskMetric.kind).toBe("breakdown");
    });

    it("returns [] when the actor has no project:read grant at all", async () => {
      const tx = { project: { findMany: jest.fn() }, task: { groupBy: jest.fn() } } as unknown as PrismaTx;
      expect(await projectsAtRiskMetric.computeLive(context([]), tx)).toEqual([]);
      expect((tx as unknown as { project: { findMany: jest.Mock } }).project.findMany).not.toHaveBeenCalled();
    });

    it("flags a project over the 30% overdue-ratio threshold with >=3 tasks; excludes one under threshold and one under the small-n floor", async () => {
      const groupBy = jest
        .fn()
        // totalGroups
        .mockResolvedValueOnce([
          { projectId: "p1", _count: { _all: 10 } }, // at risk: 4/10 = 40%
          { projectId: "p2", _count: { _all: 10 } }, // healthy: 2/10 = 20%
          { projectId: "p3", _count: { _all: 1 } }, // 1/1 = 100% but under the n>=3 floor
        ])
        // overdueGroups
        .mockResolvedValueOnce([
          { projectId: "p1", _count: { _all: 4 } },
          { projectId: "p2", _count: { _all: 2 } },
          { projectId: "p3", _count: { _all: 1 } },
        ]);
      const tx = {
        project: {
          findMany: jest.fn().mockResolvedValue([
            { id: "p1", name: "Project One" },
            { id: "p2", name: "Project Two" },
            { id: "p3", name: "Project Three" },
          ]),
        },
        task: { groupBy },
      } as unknown as PrismaTx;

      const rows = await projectsAtRiskMetric.computeLive(context(["project:read:tenant"]), tx);
      expect(rows).toEqual([{ project: "Project One", overdueRatio: 40 }]);
    });

    it("returns [] when there are no visible projects with any tasks", async () => {
      const tx = {
        project: { findMany: jest.fn().mockResolvedValue([]) },
        task: { groupBy: jest.fn() },
      } as unknown as PrismaTx;
      expect(await projectsAtRiskMetric.computeLive(context(["project:read:tenant"]), tx)).toEqual([]);
      expect((tx as unknown as { task: { groupBy: jest.Mock } }).task.groupBy).not.toHaveBeenCalled();
    });
  });
});
