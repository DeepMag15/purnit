import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  tasksOpenCountMetric,
  tasksOverdueCountMetric,
  tasksCompletionRateMetric,
  tasksByPriorityMetric,
  tasksByProjectStatusMetric,
  tasksStatusFunnelMetric,
  tasksCompletionLeaderboardMetric,
  tasksAssigneeWorkloadMetric,
} from "./tasks.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("tasks metrics", () => {
  it("every scalar/breakdown metric requires task:read", () => {
    expect(tasksOpenCountMetric.requiredPermission).toBe("task:read");
    expect(tasksOverdueCountMetric.requiredPermission).toBe("task:read");
    expect(tasksCompletionRateMetric.requiredPermission).toBe("task:read");
    expect(tasksByPriorityMetric.requiredPermission).toBe("task:read");
  });

  it("tasksOpenCountMetric.computeLive filters status: todo via tasksWhere", async () => {
    const tx = { task: { count: jest.fn().mockResolvedValue(5) } } as unknown as PrismaTx;
    const value = await tasksOpenCountMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(value).toBe(5);
    const call = (tx as unknown as { task: { count: jest.Mock } }).task.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", status: "todo" });
  });

  it("tasksOverdueCountMetric.computeLive filters via tasksWhere's overdue param", async () => {
    const tx = { task: { count: jest.fn().mockResolvedValue(2) } } as unknown as PrismaTx;
    await tasksOverdueCountMetric.computeLive(context(["task:read:tenant"]), tx);
    const call = (tx as unknown as { task: { count: jest.Mock } }).task.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", dueDate: { lt: expect.any(Date) }, status: { not: "done" } });
  });

  it("tasksCompletionRateMetric.computeLive computes a percentage from done/total", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(4);
    const tx = { task: { count: countMock } } as unknown as PrismaTx;
    const value = await tasksCompletionRateMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(value).toBe(40);
  });

  it("tasksCompletionRateMetric.computeLive returns 0 with no tasks in scope, no division by zero", async () => {
    const tx = { task: { count: jest.fn().mockResolvedValue(0) } } as unknown as PrismaTx;
    expect(await tasksCompletionRateMetric.computeLive(context(["task:read:tenant"]), tx)).toBe(0);
  });

  it("tasksCompletionRateMetric.snapshot.computeDaily returns a tenant-wide row plus one row per department, grouped through task.project.departmentId", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(20).mockResolvedValueOnce(5); // tenant-wide: 5/20 = 25
    const tx = {
      task: {
        count: countMock,
        findMany: jest.fn().mockResolvedValue([
          { status: "done", project: { departmentId: "d1" } },
          { status: "todo", project: { departmentId: "d1" } },
          { status: "done", project: { departmentId: "d2" } },
        ]),
      },
    } as unknown as PrismaTx;
    const rows = await tasksCompletionRateMetric.snapshot!.computeDaily("t1", tx);
    expect(rows).toEqual(
      expect.arrayContaining([
        { departmentId: null, value: 25 },
        { departmentId: "d1", value: 50 },
        { departmentId: "d2", value: 100 },
      ]),
    );
    expect(rows).toHaveLength(3);
    expect(countMock.mock.calls[0][0].where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("tasksCompletionRateMetric.snapshot.computeDaily excludes a task whose project has no department from every per-department row", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const tx = {
      task: {
        count: countMock,
        findMany: jest.fn().mockResolvedValue([
          { status: "done", project: { departmentId: null } },
          { status: "todo", project: { departmentId: null } },
        ]),
      },
    } as unknown as PrismaTx;
    const rows = await tasksCompletionRateMetric.snapshot!.computeDaily("t1", tx);
    expect(rows).toEqual([{ departmentId: null, value: 50 }]);
  });

  it("tasksOpenCountMetric.computeLive layers a departmentId filter on top of tasksWhere's own scope condition", async () => {
    const tx = { task: { count: jest.fn().mockResolvedValue(3) } } as unknown as PrismaTx;
    await tasksOpenCountMetric.computeLive(context(["task:read:tenant"]), tx, { departmentId: "d1" });
    const call = (tx as unknown as { task: { count: jest.Mock } }).task.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ status: "todo", project: { departmentId: "d1" } });
  });

  it("tasksOpenCountMetric.computeLive maps an employeeId filter onto tasksWhere's assigneeId", async () => {
    const tx = { task: { count: jest.fn().mockResolvedValue(1) } } as unknown as PrismaTx;
    await tasksOpenCountMetric.computeLive(context(["task:read:tenant"]), tx, { employeeId: "u2" });
    const call = (tx as unknown as { task: { count: jest.Mock } }).task.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ assigneeId: "u2" });
  });

  it("tasksByPriorityMetric.computeLive maps groupBy results to {priority, count}", async () => {
    const tx = {
      task: { groupBy: jest.fn().mockResolvedValue([{ priority: "high", _count: { _all: 3 } }]) },
    } as unknown as PrismaTx;
    const rows = await tasksByPriorityMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(rows).toEqual([{ priority: "high", count: 3 }]);
  });

  it("tasksByProjectStatusMetric.computeLive pivots a (project, status) groupBy into one row per project", async () => {
    const tx = {
      task: {
        groupBy: jest.fn().mockResolvedValue([
          { projectId: "p1", status: "todo", _count: { _all: 2 } },
          { projectId: "p1", status: "done", _count: { _all: 3 } },
          { projectId: "p2", status: "todo", _count: { _all: 1 } },
        ]),
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "p1", name: "Alpha" }, { id: "p2", name: "Beta" }]) },
    } as unknown as PrismaTx;
    const rows = await tasksByProjectStatusMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(rows).toEqual(
      expect.arrayContaining([
        { project: "Alpha", todo: 2, done: 3 },
        { project: "Beta", todo: 1 },
      ]),
    );
  });

  it("tasksStatusFunnelMetric.computeLive returns rows in fixed todo -> in_progress -> done stage order, skipping missing stages", async () => {
    const tx = {
      task: {
        groupBy: jest.fn().mockResolvedValue([
          { status: "done", _count: { _all: 5 } },
          { status: "todo", _count: { _all: 8 } },
        ]),
      },
    } as unknown as PrismaTx;
    const rows = await tasksStatusFunnelMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(rows).toEqual([
      { status: "todo", count: 8 },
      { status: "done", count: 5 },
    ]);
  });

  it("tasksCompletionLeaderboardMetric.computeLive returns a desc-sorted, displayName-joined top list of done-task counts", async () => {
    const tx = {
      task: {
        groupBy: jest.fn().mockResolvedValue([
          { assigneeId: "u1", _count: { _all: 7 } },
          { assigneeId: "u2", _count: { _all: 3 } },
        ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Alice" }, { id: "u2", displayName: "Bob" }]) },
    } as unknown as PrismaTx;
    const rows = await tasksCompletionLeaderboardMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(rows).toEqual([
      { assignee: "Alice", count: 7 },
      { assignee: "Bob", count: 3 },
    ]);
    const call = (tx as unknown as { task: { groupBy: jest.Mock } }).task.groupBy.mock.calls[0][0];
    expect(call.where).toMatchObject({ status: "done" });
  });

  it("tasksAssigneeWorkloadMetric.computeLive merges total and done groupBys into {assignee, x: taskCount, y: completionRate}, with no division by zero", async () => {
    const tx = {
      task: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { assigneeId: "u1", _count: { _all: 4 } },
            { assigneeId: "u2", _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([{ assigneeId: "u1", _count: { _all: 2 } }]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Alice" }, { id: "u2", displayName: "Bob" }]) },
    } as unknown as PrismaTx;
    const rows = await tasksAssigneeWorkloadMetric.computeLive(context(["task:read:tenant"]), tx);
    expect(rows).toEqual(
      expect.arrayContaining([
        { assignee: "Alice", x: 4, y: 50 },
        { assignee: "Bob", x: 2, y: 0 },
      ]),
    );
  });
});
