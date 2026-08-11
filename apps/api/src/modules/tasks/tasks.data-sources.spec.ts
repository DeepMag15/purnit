import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { tasksWhere, taskDetailDataSource } from "./tasks.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

// Never actually invoked by any test below — none of these grants resolve to
// "department-subtree", the only branch that touches `tx` (see
// department-subtree.ts). A real `PrismaTx` isn't needed to exercise the
// pure branching logic this spec covers.
const tx = {} as PrismaTx;

function context(grants: string[], userDepartmentId: string | null = null): DataSourceContext {
  return {
    tenantId: "t1",
    userId: "u1",
    userDepartmentId,
    effective: collapsePermissions(grants),
  };
}

describe("tasksWhere", () => {
  it("returns null (skip the query) when there is no task:read grant at all", async () => {
    expect(await tasksWhere(tx, context([]), {})).toBeNull();
  });

  it("tenant scope filters only by tenantId", async () => {
    expect(await tasksWhere(tx, context(["task:read:tenant"]), {})).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("own scope filters by assigneeId (Task has no ownerId column)", async () => {
    expect(await tasksWhere(tx, context(["task:read:own"]), {})).toEqual({ tenantId: "t1", deletedAt: null, assigneeId: "u1" });
  });

  it("department/team scope includes both the owning project's departmentId AND tasks assigned to me", async () => {
    expect(await tasksWhere(tx, context(["task:read:department"], "d1"), {})).toEqual({
      tenantId: "t1",
      deletedAt: null,
      OR: [{ assigneeId: "u1" }, { project: { departmentId: "d1" } }],
    });
  });

  // Regression test for a real, user-reported bug: a task assigned to a
  // team-scoped user was invisible whenever its project's department
  // didn't match theirs (including when the project had no department at
  // all) — the old code ANDed the department condition with the caller's
  // own assigneeId instead of OR-ing them. "Assigned to me" must always be
  // sufficient on its own, regardless of department match.
  it("department/team scope with no department set still shows tasks assigned to me (not null)", async () => {
    expect(await tasksWhere(tx, context(["task:read:team"], null), {})).toEqual({
      tenantId: "t1",
      deletedAt: null,
      OR: [{ assigneeId: "u1" }],
    });
  });

  it("department/team scope: an explicit assigneeId for someone else still requires department match (AND, not OR)", async () => {
    const where = await tasksWhere(tx, context(["task:read:team"], "d1"), { assigneeId: "teammate-1" });
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      OR: [{ assigneeId: "u1" }, { project: { departmentId: "d1" } }],
      assigneeId: "teammate-1",
    });
  });

  it("merges an explicit status filter for tenant-scoped reads", async () => {
    expect(await tasksWhere(tx, context(["task:read:tenant"]), { status: "todo" })).toEqual({
      tenantId: "t1",
      deletedAt: null,
      status: "todo",
    });
  });

  it("overdue implies a not-done status filter when no explicit status is given", async () => {
    const where = await tasksWhere(tx, context(["task:read:tenant"]), { overdue: true });
    expect(where).toMatchObject({ tenantId: "t1", deletedAt: null, status: { not: "done" } });
    expect(where!.dueDate).toBeDefined();
  });

  it("an explicit status filter overrides overdue's implied one", async () => {
    const where = await tasksWhere(tx, context(["task:read:tenant"]), { overdue: true, status: "in_progress" });
    expect(where!.status).toBe("in_progress");
  });

  // Security property: scope enforcement must win over anything the client
  // supplies, not merge with it — an "own"-scoped caller cannot see someone
  // else's tasks by passing a different assigneeId param.
  it("own scope overrides a client-supplied assigneeId rather than honoring it", async () => {
    const where = await tasksWhere(tx, context(["task:read:own"]), { assigneeId: "someone-else" });
    expect(where!.assigneeId).toBe("u1");
  });

  it("a client-supplied assigneeId is honored as-is under tenant scope", async () => {
    const where = await tasksWhere(tx, context(["task:read:tenant"]), { assigneeId: "teammate-1" });
    expect(where!.assigneeId).toBe("teammate-1");
  });

  // Phase B (Analytics filters): departmentId/projectId are applied before
  // scope branching, so every scope path inherits them — including the
  // early "own"/"tenant" returns, which a naive implementation could easily
  // miss since they return before the OR-scope block runs.
  it("a departmentId filter narrows tenant scope via the owning project's departmentId", async () => {
    const where = await tasksWhere(tx, context(["task:read:tenant"]), { departmentId: "d9" });
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, project: { departmentId: "d9" } });
  });

  it("a departmentId filter is still applied under own scope, layered alongside the assigneeId floor", async () => {
    const where = await tasksWhere(tx, context(["task:read:own"]), { departmentId: "d9" });
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, assigneeId: "u1", project: { departmentId: "d9" } });
  });

  it("a departmentId filter is AND-ed alongside department/team scope's own OR condition, never replacing it", async () => {
    const where = await tasksWhere(tx, context(["task:read:department"], "d1"), { departmentId: "d9" });
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      project: { departmentId: "d9" },
      OR: [{ assigneeId: "u1" }, { project: { departmentId: "d1" } }],
    });
  });

  it("a projectId filter is honored as a direct passthrough regardless of scope", async () => {
    const where = await tasksWhere(tx, context(["task:read:tenant"]), { projectId: "p1" });
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, projectId: "p1" });
  });
});

// Frontend Structural Redesign, Phase 0.
describe("task.detail", () => {
  it("throws NotFoundException when the actor has no task:read grant at all", async () => {
    const detailTx = {} as PrismaTx;
    await expect(taskDetailDataSource.resolve({ id: "tk1" }, context([]), detailTx)).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException when the task doesn't exist or is out of the actor's scope", async () => {
    const detailTx = { task: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(taskDetailDataSource.resolve({ id: "tk1" }, context(["task:read:tenant"]), detailTx)).rejects.toThrow(NotFoundException);
  });

  it("scopes the lookup by the actor's own tasksWhere, merged with the requested id", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const detailTx = { task: { findFirst } } as unknown as PrismaTx;
    await expect(taskDetailDataSource.resolve({ id: "tk1" }, context(["task:read:own"]), detailTx)).rejects.toThrow(NotFoundException);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: "t1", deletedAt: null, assigneeId: "u1", id: "tk1" });
  });

  it("returns the task with resolved assignee/project names", async () => {
    const detailTx = {
      task: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "tk1", title: "Fix bug", description: null, status: "todo", priority: "high", assigneeId: "u1", projectId: "p1" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ displayName: "Alice" }) },
      project: { findFirst: jest.fn().mockResolvedValue({ name: "Redesign" }) },
    } as unknown as PrismaTx;

    const result = (await taskDetailDataSource.resolve({ id: "tk1" }, context(["task:read:tenant"]), detailTx)) as {
      assigneeName: string | null;
      projectName: string | null;
    };

    expect(result.assigneeName).toBe("Alice");
    expect(result.projectName).toBe("Redesign");
  });

  it("returns a null assigneeName without querying user when the task is unassigned", async () => {
    const userFindFirst = jest.fn();
    const detailTx = {
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: "tk1", title: "Unassigned", description: null, status: "todo", priority: "medium", assigneeId: null, projectId: "p1" }),
      },
      user: { findFirst: userFindFirst },
      project: { findFirst: jest.fn().mockResolvedValue({ name: "Redesign" }) },
    } as unknown as PrismaTx;

    const result = (await taskDetailDataSource.resolve({ id: "tk1" }, context(["task:read:tenant"]), detailTx)) as { assigneeName: string | null };
    expect(result.assigneeName).toBeNull();
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it("has no requiredPermission — visibility is enforced entirely by tasksWhere, same as tasks.list", () => {
    expect(taskDetailDataSource.requiredPermission).toBeUndefined();
  });

  it("computes canUpdate from ctx.effective, not a hardcoded true", async () => {
    const detailTx = {
      task: { findFirst: jest.fn().mockResolvedValue({ id: "tk1", title: "Fix bug", assigneeId: null, projectId: "p1" }) },
      project: { findFirst: jest.fn().mockResolvedValue({ name: "Redesign" }) },
    } as unknown as PrismaTx;

    const readOnly = (await taskDetailDataSource.resolve({ id: "tk1" }, context(["task:read:tenant"]), detailTx)) as { canUpdate: boolean };
    expect(readOnly.canUpdate).toBe(false);

    const editable = (await taskDetailDataSource.resolve({ id: "tk1" }, context(["task:read:tenant", "task:update:tenant"]), detailTx)) as {
      canUpdate: boolean;
    };
    expect(editable.canUpdate).toBe(true);
  });
});
