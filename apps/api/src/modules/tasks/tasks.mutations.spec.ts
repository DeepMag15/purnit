import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { notificationRecipientFor, taskCreateMutation, taskUpdateDueDateMutation } from "./tasks.mutations";
import { collapsePermissions } from "../../rbac/permission-collapse";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("notificationRecipientFor", () => {
  it("returns the assignee when they differ from the actor", () => {
    expect(notificationRecipientFor("u2", "u1")).toBe("u2");
  });

  it("returns null when the actor is the assignee (self-action, not notification-worthy)", () => {
    expect(notificationRecipientFor("u1", "u1")).toBeNull();
  });

  it("returns null when there is no assignee", () => {
    expect(notificationRecipientFor(null, "u1")).toBeNull();
    expect(notificationRecipientFor(undefined, "u1")).toBeNull();
  });
});

describe("task.create — input validation (Calendar & Scheduling reminder fields)", () => {
  it("rejects reminderMinutesBefore without a dueDate", () => {
    const result = taskCreateMutation.inputSchema.safeParse({ projectId: "p1", title: "x", reminderMinutesBefore: 30 });
    expect(result.success).toBe(false);
  });

  it("accepts reminderMinutesBefore alongside a dueDate", () => {
    const result = taskCreateMutation.inputSchema.safeParse({ projectId: "p1", title: "x", dueDate: "2026-08-10", reminderMinutesBefore: 30 });
    expect(result.success).toBe(true);
  });

  it("accepts a dueDate with no reminder at all", () => {
    const result = taskCreateMutation.inputSchema.safeParse({ projectId: "p1", title: "x", dueDate: "2026-08-10" });
    expect(result.success).toBe(true);
  });
});

describe("task.create — reminder enqueue", () => {
  it("enqueues a reminder targeting the assignee when dueDate + reminderMinutesBefore are both set", async () => {
    const dueDate = new Date("2026-08-10T00:00:00Z");
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1" }) },
      task: { create: jest.fn().mockResolvedValue({ id: "tk1", title: "Report", dueDate, projectId: "p1" }) },
      calendarReminder: { createMany: jest.fn() },
    } as unknown as PrismaTx;

    await taskCreateMutation.resolve({ projectId: "p1", title: "Report", dueDate: dueDate.toISOString(), reminderMinutesBefore: 60 }, context(), tx);

    const mocks = tx as unknown as { calendarReminder: { createMany: jest.Mock } };
    expect(mocks.calendarReminder.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.calendarReminder.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "t1", sourceType: "task", sourceId: "tk1", recipientUserId: "u1", availableAt: new Date(dueDate.getTime() - 60 * 60_000) }],
    });
  });

  it("does not enqueue a reminder when no dueDate is set", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1" }) },
      task: { create: jest.fn().mockResolvedValue({ id: "tk1", title: "Report", dueDate: null, projectId: "p1" }) },
      calendarReminder: { createMany: jest.fn() },
    } as unknown as PrismaTx;

    await taskCreateMutation.resolve({ projectId: "p1", title: "Report" }, context(), tx);

    expect((tx as unknown as { calendarReminder: { createMany: jest.Mock } }).calendarReminder.createMany).not.toHaveBeenCalled();
  });
});

describe("task.updateDueDate (Analytics Phase G — Interactive Kanban & Gantt)", () => {
  it("requires task:update", () => {
    expect(taskUpdateDueDateMutation.requiredPermission).toBe("task:update");
  });

  it("updates dueDate to a real parsed Date for an in-scope task", async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: "task1", assigneeId: "u1", project: { id: "p1", ownerId: "u1", departmentId: null } });
    const update = jest.fn().mockResolvedValue({ id: "task1", dueDate: new Date("2026-09-01") });
    const tx = { task: { findFirst, update } } as unknown as PrismaTx;

    await taskUpdateDueDateMutation.resolve({ id: "task1", dueDate: "2026-09-01" }, context(["task:update:tenant"]), tx);
    expect(update.mock.calls[0]![0]).toEqual({ where: { id: "task1" }, data: { dueDate: new Date("2026-09-01") } });
  });

  it("clears dueDate when given null", async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: "task1", assigneeId: "u1", project: { id: "p1", ownerId: "u1", departmentId: null } });
    const update = jest.fn().mockResolvedValue({ id: "task1", dueDate: null });
    const tx = { task: { findFirst, update } } as unknown as PrismaTx;

    await taskUpdateDueDateMutation.resolve({ id: "task1", dueDate: null }, context(["task:update:tenant"]), tx);
    expect(update.mock.calls[0]![0].data).toEqual({ dueDate: null });
  });

  it("throws NotFoundException for a task that doesn't exist in this tenant", async () => {
    const tx = { task: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(taskUpdateDueDateMutation.resolve({ id: "ghost", dueDate: "2026-09-01" }, context(["task:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws ForbiddenException for a caller outside their own-scope floor", async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: "task1", assigneeId: "someone-else", project: { id: "p1", ownerId: "someone-else", departmentId: "d-other" } });
    const tx = { task: { findFirst } } as unknown as PrismaTx;
    await expect(taskUpdateDueDateMutation.resolve({ id: "task1", dueDate: "2026-09-01" }, context(["task:update:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
