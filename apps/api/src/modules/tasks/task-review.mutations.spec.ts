import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { taskSubmitForReviewMutation, taskReviewMutation, taskUpdateStatusMutation } from "./tasks.mutations";
import { collapsePermissions } from "../../rbac/permission-collapse";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/**
 * Projects ecosystem review — submit → review → approval.
 *
 * Before this a person was given work, did it, and marked it done themselves.
 * These pin the three properties that make the step mean something:
 * only the assignee submits, never the assignee decides, and a submitted task
 * cannot be walked out of review by the ordinary status route.
 */
function ctx(grants: string[] = [], userId = "reviewer1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

function txWith(task: Record<string, unknown> | null, over: Record<string, unknown> = {}) {
  return {
    task: {
      findFirst: jest.fn().mockResolvedValue(task),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "t-1", title: "Ship it", projectId: "p1", ...task, ...data })),
    },
    project: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
    notification: { create: jest.fn() },
    ...over,
  } as unknown as PrismaTx;
}

// `requireTaskInScope` includes the task's project (for the department
// branch of the scope check), so the fake row carries one.
const ASSIGNED = {
  id: "t-1",
  title: "Ship it",
  projectId: "p1",
  status: "in_progress",
  assigneeId: "worker1",
  submittedById: null,
  project: { id: "p1", ownerId: "lead1", departmentId: null },
};

describe("task.submitForReview", () => {
  it("carries no permission — submitting is ownership, not authority", () => {
    expect(taskSubmitForReviewMutation.requiredPermission).toBeUndefined();
  });

  it("lets the assignee submit their own work", async () => {
    const tx = txWith(ASSIGNED);
    const result = (await taskSubmitForReviewMutation.resolve({ id: "t-1", note: "ready" }, ctx([], "worker1"), tx)) as { status: string };
    expect(result.status).toBe("in_review");
    const data = (tx as unknown as { task: { update: jest.Mock } }).task.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ status: "in_review", submittedById: "worker1", reviewNote: "ready" });
  });

  it("refuses anyone who is not the assignee, however senior", async () => {
    // A Lead holding every task grant still cannot submit somebody's work as
    // though that person had finished it.
    const tx = txWith(ASSIGNED);
    await expect(
      taskSubmitForReviewMutation.resolve({ id: "t-1" }, ctx(["task:update:tenant", "task:review:tenant"], "lead1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("clears any previous decision, so a resubmission is not shown as already reviewed", async () => {
    const tx = txWith({ ...ASSIGNED, status: "in_progress", reviewedById: "reviewer1", reviewedAt: new Date() });
    await taskSubmitForReviewMutation.resolve({ id: "t-1" }, ctx([], "worker1"), tx);
    const data = (tx as unknown as { task: { update: jest.Mock } }).task.update.mock.calls[0]![0].data;
    expect(data).toMatchObject({ reviewedById: null, reviewedAt: null });
  });

  it("refuses to submit twice, or to submit finished work", async () => {
    await expect(
      taskSubmitForReviewMutation.resolve({ id: "t-1" }, ctx([], "worker1"), txWith({ ...ASSIGNED, status: "in_review" })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      taskSubmitForReviewMutation.resolve({ id: "t-1" }, ctx([], "worker1"), txWith({ ...ASSIGNED, status: "done" })),
    ).rejects.toThrow(BadRequestException);
  });

  it("404s a task that doesn't exist", async () => {
    await expect(taskSubmitForReviewMutation.resolve({ id: "gone" }, ctx([], "worker1"), txWith(null))).rejects.toThrow(NotFoundException);
  });
});

describe("task.review", () => {
  const SUBMITTED = { ...ASSIGNED, status: "in_review", submittedById: "worker1" };

  it("is gated on task:review, not task:update", () => {
    // task:update is what the assignee already holds; gating review on it
    // would make the whole step self-serve.
    expect(taskReviewMutation.requiredPermission).toBe("task:review");
  });

  it("approving finishes the task and tells the assignee", async () => {
    const tx = txWith(SUBMITTED);
    const result = (await taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, ctx(["task:review:tenant"]), tx)) as { status: string };
    expect(result.status).toBe("done");
    expect((tx as unknown as { notification: { create: jest.Mock } }).notification.create).toHaveBeenCalled();
    const note = (tx as unknown as { notification: { create: jest.Mock } }).notification.create.mock.calls[0]![0].data;
    expect(note).toMatchObject({ userId: "worker1", type: "task.approved" });
  });

  it("requesting changes sends it back to in_progress with the note", async () => {
    const tx = txWith(SUBMITTED);
    const result = (await taskReviewMutation.resolve(
      { id: "t-1", decision: "request_changes", note: "Add the test output" },
      ctx(["task:review:tenant"]),
      tx,
    )) as { status: string };
    expect(result.status).toBe("in_progress");
    const data = (tx as unknown as { task: { update: jest.Mock } }).task.update.mock.calls[0]![0].data;
    expect(data.reviewNote).toBe("Add the test output");
  });

  it("refuses the assignee even when they hold task:review", async () => {
    // The property the permission alone cannot carry: a Lead reviewing their
    // OWN submission passes every permission check.
    const tx = txWith(SUBMITTED);
    await expect(
      taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, ctx(["task:review:tenant"], "worker1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses whoever submitted it, even if the task was since reassigned", async () => {
    const tx = txWith({ ...SUBMITTED, assigneeId: "someoneElse", submittedById: "worker1" });
    await expect(
      taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, ctx(["task:review:tenant"], "worker1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses a task that was never submitted", async () => {
    await expect(
      taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, ctx(["task:review:tenant"]), txWith(ASSIGNED)),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("task.updateStatus and the review gate", () => {
  it("refuses to move a submitted task out of review", async () => {
    // Without this the assignee — who holds task:update by definition — could
    // simply mark their own submitted work done and skip the reviewer.
    const tx = txWith({ ...ASSIGNED, status: "in_review" });
    await expect(
      taskUpdateStatusMutation.resolve({ id: "t-1", status: "done" }, ctx(["task:update:tenant"], "worker1"), tx),
    ).rejects.toThrow(/waiting on a review/);
  });

  it("still lets ordinary work go straight to done — review stays optional", async () => {
    const tx = txWith(ASSIGNED);
    const result = (await taskUpdateStatusMutation.resolve({ id: "t-1", status: "done" }, ctx(["task:update:tenant"], "worker1"), tx)) as {
      status: string;
    };
    expect(result.status).toBe("done");
  });
});

/**
 * ⚠️ A scope widening, so pinned deliberately.
 *
 * "Review my team's work" is defined by who the person is, but the scope check
 * reads the PROJECT's departmentId — and `project.create` leaves that null by
 * default. So a Lead and their direct report, both in Ops, were out of scope
 * for each other. Verified live before the fix: an IT Lead holding
 * task:review:team was refused on their own team member's submitted work.
 */
describe("task scope falls back to the assignee's own department", () => {
  const SUBMITTED = {
    id: "t-1",
    title: "Ship it",
    projectId: "p1",
    status: "in_review",
    assigneeId: "worker1",
    submittedById: "worker1",
    // The default a project carries: no department at all.
    project: { id: "p1", ownerId: "admin1", departmentId: null },
  };

  function tx(assigneeDepartmentId: string | null) {
    return {
      task: {
        findFirst: jest.fn().mockResolvedValue(SUBMITTED),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...SUBMITTED, ...data })),
      },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue({ departmentId: assigneeDepartmentId }) },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;
  }

  function leadCtx(departmentId: string | null): MutationContext {
    return { tenantId: "t1", userId: "lead1", userDepartmentId: departmentId, effective: collapsePermissions(["task:review:team"]) };
  }

  it("lets a Lead review a team member's work on a department-less project", async () => {
    const result = (await taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, leadCtx("ops"), tx("ops"))) as { status: string };
    expect(result.status).toBe("done");
  });

  it("still refuses a Lead from a different department", async () => {
    // The widening must not become "anyone at team scope reviews anything".
    await expect(
      taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, leadCtx("finance"), tx("ops")),
    ).rejects.toThrow(ForbiddenException);
  });

  it("still refuses when the assignee has no department to match on", async () => {
    await expect(taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, leadCtx("ops"), tx(null))).rejects.toThrow(ForbiddenException);
  });

  it("lets a project MEMBER review regardless of department", async () => {
    const memberTx = {
      task: {
        findFirst: jest.fn().mockResolvedValue(SUBMITTED),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...SUBMITTED, ...data })),
      },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
      user: { findFirst: jest.fn().mockResolvedValue({ departmentId: null }) },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;
    const result = (await taskReviewMutation.resolve({ id: "t-1", decision: "approve" }, leadCtx("finance"), memberTx)) as { status: string };
    expect(result.status).toBe("done");
  });
});
