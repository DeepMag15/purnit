import { enqueueReminders } from "./reminder-outbox";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

const START = new Date("2026-08-10T09:00:00Z");

describe("enqueueReminders", () => {
  it("no-ops when reminderMinutesBefore is omitted", async () => {
    const tx = { calendarReminder: { createMany: jest.fn() } } as unknown as PrismaTx;
    await enqueueReminders(tx, "t1", "meeting", "m1", START, undefined, ["u1", "u2"]);
    expect((tx as unknown as { calendarReminder: { createMany: jest.Mock } }).calendarReminder.createMany).not.toHaveBeenCalled();
  });

  it("no-ops when recipientUserIds is empty", async () => {
    const tx = { calendarReminder: { createMany: jest.fn() } } as unknown as PrismaTx;
    await enqueueReminders(tx, "t1", "meeting", "m1", START, 30, []);
    expect((tx as unknown as { calendarReminder: { createMany: jest.Mock } }).calendarReminder.createMany).not.toHaveBeenCalled();
  });

  it("computes availableAt as startAt minus reminderMinutesBefore, one batched createMany for every recipient", async () => {
    const tx = { calendarReminder: { createMany: jest.fn() } } as unknown as PrismaTx;
    await enqueueReminders(tx, "t1", "task", "tk1", START, 45, ["u1", "u2"]);

    const mocks = tx as unknown as { calendarReminder: { createMany: jest.Mock } };
    expect(mocks.calendarReminder.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.calendarReminder.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: "t1", sourceType: "task", sourceId: "tk1", recipientUserId: "u1", availableAt: new Date(START.getTime() - 45 * 60_000) },
        { tenantId: "t1", sourceType: "task", sourceId: "tk1", recipientUserId: "u2", availableAt: new Date(START.getTime() - 45 * 60_000) },
      ],
    });
  });

  it("still enqueues a reminder whose computed availableAt has already passed (the poller picks it up immediately)", async () => {
    const tx = { calendarReminder: { createMany: jest.fn() } } as unknown as PrismaTx;
    const almostStarted = new Date(Date.now() + 1000); // 1s from now
    await enqueueReminders(tx, "t1", "meeting", "m1", almostStarted, 60, ["u1"]); // 60min lead time on a 1s-away meeting

    expect((tx as unknown as { calendarReminder: { createMany: jest.Mock } }).calendarReminder.createMany).toHaveBeenCalledTimes(1);
  });
});
