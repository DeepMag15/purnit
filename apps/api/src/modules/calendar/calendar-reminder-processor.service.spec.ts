import { resolveReminderSource, reminderNotificationType, reminderTitle } from "./calendar-reminder-processor.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

const START = new Date("2026-08-10T09:00:00Z");

describe("resolveReminderSource", () => {
  it("returns title/startAt for a live meeting", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue({ title: "Standup", scheduledStart: START }) } } as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "meeting", "m1")).resolves.toEqual({ title: "Standup", startAt: START });
    expect((tx as unknown as { meeting: { findFirst: jest.Mock } }).meeting.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", tenantId: "t1", cancelledAt: null },
    });
  });

  it("returns null for a cancelled or gone meeting — findFirst's own cancelledAt: null filter already excludes it", async () => {
    const tx = { meeting: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "meeting", "m1")).resolves.toBeNull();
  });

  it("returns title/startAt for a live calendar event", async () => {
    const tx = { calendarEvent: { findFirst: jest.fn().mockResolvedValue({ title: "Town hall", startAt: START }) } } as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "calendarEvent", "ce1")).resolves.toEqual({ title: "Town hall", startAt: START });
  });

  it("returns null for a soft-deleted or gone calendar event", async () => {
    const tx = { calendarEvent: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "calendarEvent", "ce1")).resolves.toBeNull();
  });

  it("returns title/dueDate-as-startAt for a task with a due date", async () => {
    const tx = { task: { findFirst: jest.fn().mockResolvedValue({ title: "Report", dueDate: START }) } } as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "task", "tk1")).resolves.toEqual({ title: "Report", startAt: START });
  });

  it("returns null for a task whose dueDate was cleared or that's gone", async () => {
    const tx = { task: { findFirst: jest.fn().mockResolvedValue({ title: "Report", dueDate: null }) } } as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "task", "tk1")).resolves.toBeNull();
  });

  it("returns null for an unrecognized sourceType", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(resolveReminderSource(tx, "t1", "unknown", "x1")).resolves.toBeNull();
  });
});

describe("reminderNotificationType / reminderTitle", () => {
  it("maps each sourceType to its own notification type and title", () => {
    expect(reminderNotificationType("meeting")).toBe("meeting.reminder");
    expect(reminderNotificationType("calendarEvent")).toBe("calendarEvent.reminder");
    expect(reminderNotificationType("task")).toBe("task.reminder");

    expect(reminderTitle("meeting")).toBe("Upcoming meeting");
    expect(reminderTitle("calendarEvent")).toBe("Upcoming calendar event");
    expect(reminderTitle("task")).toBe("Task due soon");
  });
});
