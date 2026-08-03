import { notificationRecipientFor, taskCreateMutation } from "./tasks.mutations";
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
