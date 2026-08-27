import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { calendarEventCreateMutation, calendarEventDeleteMutation } from "./calendar.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

const START = new Date("2026-08-10T09:00:00Z");

describe("calendarEvent.create — input validation", () => {
  it("rejects an empty title", () => {
    const result = calendarEventCreateMutation.inputSchema.safeParse({ title: "", startAt: START });
    expect(result.success).toBe(false);
  });

  it("rejects endAt before startAt", () => {
    const result = calendarEventCreateMutation.inputSchema.safeParse({ title: "x", startAt: START, endAt: new Date("2026-08-10T08:00:00Z") });
    expect(result.success).toBe(false);
  });

  it("rejects departmentId and broadcastTenantWide both set", () => {
    const result = calendarEventCreateMutation.inputSchema.safeParse({ title: "x", startAt: START, departmentId: "d1", broadcastTenantWide: true });
    expect(result.success).toBe(false);
  });

  it("accepts a valid personal input (no departmentId, no broadcastTenantWide)", () => {
    const result = calendarEventCreateMutation.inputSchema.safeParse({ title: "x", startAt: START });
    expect(result.success).toBe(true);
  });

  it("accepts a valid broadcast input", () => {
    const result = calendarEventCreateMutation.inputSchema.safeParse({ title: "x", startAt: START, departmentId: "d1" });
    expect(result.success).toBe(true);
  });
});

describe("calendarEvent.create — authorization", () => {
  it("personal (own-scope) creation succeeds even with zero broadcast grants", async () => {
    const tx = {
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "Dentist", startAt: START }) },
    } as unknown as PrismaTx;

    await calendarEventCreateMutation.resolve({ title: "Dentist", startAt: START }, context([]), tx);

    expect((tx as unknown as { calendarEvent: { create: jest.Mock } }).calendarEvent.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", authorId: "u1", isPrivate: true, departmentId: null, title: "Dentist", description: undefined, startAt: START, endAt: undefined },
    });
  });

  it("throws ForbiddenException for a broadcast attempt with no calendarEvent:create grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(calendarEventCreateMutation.resolve({ title: "x", startAt: START, departmentId: "d1" }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("a department-scoped actor can broadcast to their own department", async () => {
    const tx = {
      // resolveAudienceUserIds always walks the target department's subtree
      // (write-side, independent of the actor's own scope tier) — needed
      // whenever a broadcast targets a specific department, regardless of
      // whether the actor's granted scope is "department" or wider.
      $queryRaw: jest.fn().mockResolvedValue([{ id: "d1" }]),
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "Town hall", startAt: START }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await calendarEventCreateMutation.resolve({ title: "Town hall", startAt: START, departmentId: "d1" }, context(["calendarEvent:create:department"], "d1"), tx);

    expect((tx as unknown as { calendarEvent: { create: jest.Mock } }).calendarEvent.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", authorId: "u1", isPrivate: false, departmentId: "d1", title: "Town hall", description: undefined, startAt: START, endAt: undefined },
    });
  });

  it("a department-scoped actor is rejected broadcasting to a sibling department", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(
      calendarEventCreateMutation.resolve({ title: "x", startAt: START, departmentId: "sibling" }, context(["calendarEvent:create:department"], "d1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("a department-subtree-scoped actor can broadcast within their subtree", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]),
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "x", startAt: START }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await calendarEventCreateMutation.resolve({ title: "x", startAt: START, departmentId: "grandchild" }, context(["calendarEvent:create:department-subtree"], "root"), tx);

    expect((tx as unknown as { calendarEvent: { create: jest.Mock } }).calendarEvent.create).toHaveBeenCalled();
  });

  it("a department-subtree-scoped actor is rejected broadcasting outside their subtree", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]) } as unknown as PrismaTx;
    await expect(
      calendarEventCreateMutation.resolve({ title: "x", startAt: START, departmentId: "unrelated" }, context(["calendarEvent:create:department-subtree"], "root"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("a tenant-scoped actor can broadcast tenant-wide and to any specific department", async () => {
    const tx = {
      // Only exercised by the second call below (a specific-department
      // target) — resolveAudienceUserIds's tenant-wide branch (departmentId
      // null) never calls getDepartmentSubtreeIds at all.
      $queryRaw: jest.fn().mockResolvedValue([{ id: "anywhere" }]),
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "x", startAt: START }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await expect(
      calendarEventCreateMutation.resolve({ title: "x", startAt: START, broadcastTenantWide: true }, context(["calendarEvent:create:tenant"]), tx),
    ).resolves.toBeDefined();
    await expect(
      calendarEventCreateMutation.resolve({ title: "x", startAt: START, departmentId: "anywhere" }, context(["calendarEvent:create:tenant"]), tx),
    ).resolves.toBeDefined();
  });
});

describe("calendarEvent.create — notifications + reminders", () => {
  it("a personal event enqueues a reminder for the author only, with no Notification row", async () => {
    const tx = {
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "Dentist", startAt: START }) },
      calendarReminder: { createMany: jest.fn() },
      notification: { createMany: jest.fn() },
    } as unknown as PrismaTx;

    await calendarEventCreateMutation.resolve({ title: "Dentist", startAt: START, reminderMinutesBefore: 30 }, context([]), tx);

    const mocks = tx as unknown as { calendarReminder: { createMany: jest.Mock }; notification: { createMany: jest.Mock } };
    expect(mocks.notification.createMany).not.toHaveBeenCalled();
    expect(mocks.calendarReminder.createMany).toHaveBeenCalledTimes(1);
    const call = mocks.calendarReminder.createMany.mock.calls[0][0];
    expect(call.data).toEqual([{ tenantId: "t1", sourceType: "calendarEvent", sourceId: "ce1", recipientUserId: "u1", availableAt: new Date(START.getTime() - 30 * 60_000) }]);
  });

  it("a broadcast notifies and reminds the resolved audience via batched calls, excluding the author", async () => {
    const tx = {
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "Town hall", startAt: START }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }, { id: "u3" }]) }, // u1 is the author
      notification: { createMany: jest.fn() },
      calendarReminder: { createMany: jest.fn() },
    } as unknown as PrismaTx;

    await calendarEventCreateMutation.resolve({ title: "Town hall", startAt: START, broadcastTenantWide: true, reminderMinutesBefore: 15 }, context(["calendarEvent:create:tenant"]), tx);

    const mocks = tx as unknown as { notification: { createMany: jest.Mock }; calendarReminder: { createMany: jest.Mock } };
    expect(mocks.notification.createMany).toHaveBeenCalledTimes(1);
    const notifyCall = mocks.notification.createMany.mock.calls[0][0];
    expect(notifyCall.data.map((d: { userId: string }) => d.userId).sort()).toEqual(["u2", "u3"]);

    expect(mocks.calendarReminder.createMany).toHaveBeenCalledTimes(1);
    const reminderCall = mocks.calendarReminder.createMany.mock.calls[0][0];
    expect(reminderCall.data.map((d: { recipientUserId: string }) => d.recipientUserId).sort()).toEqual(["u2", "u3"]);
  });

  it("skips the notification call entirely when the broadcast audience is empty besides the author", async () => {
    const tx = {
      calendarEvent: { create: jest.fn().mockResolvedValue({ id: "ce1", title: "x", startAt: START }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1" }]) },
      notification: { createMany: jest.fn() },
      calendarReminder: { createMany: jest.fn() },
    } as unknown as PrismaTx;

    await calendarEventCreateMutation.resolve({ title: "x", startAt: START, broadcastTenantWide: true }, context(["calendarEvent:create:tenant"]), tx);

    expect((tx as unknown as { notification: { createMany: jest.Mock } }).notification.createMany).not.toHaveBeenCalled();
  });
});

describe("calendarEvent.delete (ownership-only, no permission gate)", () => {
  it("throws NotFoundException if the event doesn't exist", async () => {
    const tx = { calendarEvent: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(calendarEventDeleteMutation.resolve({ id: "ce1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException if the actor isn't the author", async () => {
    const tx = { calendarEvent: { findFirst: jest.fn().mockResolvedValue({ id: "ce1", authorId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(calendarEventDeleteMutation.resolve({ id: "ce1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("soft-deletes when the actor is the author", async () => {
    const tx = {
      calendarEvent: {
        findFirst: jest.fn().mockResolvedValue({ id: "ce1", authorId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "ce1", deletedAt: new Date() }),
      },
    } as unknown as PrismaTx;

    await calendarEventDeleteMutation.resolve({ id: "ce1" }, context(), tx);

    expect((tx as unknown as { calendarEvent: { update: jest.Mock } }).calendarEvent.update).toHaveBeenCalledWith({
      where: { id: "ce1" },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
