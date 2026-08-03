import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { attendanceMarkMutation, attendanceCorrectMutation } from "./attendance.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

function isUtcMidnight(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

describe("attendance.mark — input validation", () => {
  it("rejects an invalid status", () => {
    const result = attendanceMarkMutation.inputSchema.safeParse({ status: "on_vacation" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid status with no note", () => {
    const result = attendanceMarkMutation.inputSchema.safeParse({ status: "present" });
    expect(result.success).toBe(true);
  });
});

describe("attendance.mark", () => {
  it("succeeds regardless of the actor's granted scope — :own is a universal floor", async () => {
    const tx = { attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) } } as unknown as PrismaTx;

    await attendanceMarkMutation.resolve({ status: "present" }, context([]), tx);

    const call = (tx as unknown as { attendanceRecord: { upsert: jest.Mock } }).attendanceRecord.upsert.mock.calls[0][0];
    expect(call.where.tenantId_userId_date.tenantId).toBe("t1");
    expect(call.where.tenantId_userId_date.userId).toBe("u1");
    expect(isUtcMidnight(call.where.tenantId_userId_date.date)).toBe(true);
    expect(call.create).toMatchObject({ tenantId: "t1", userId: "u1", status: "present", markedById: "u1" });
    expect(call.update).toMatchObject({ status: "present", markedById: "u1" });
  });

  it("carries the optional note through to both create and update branches", async () => {
    const tx = { attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) } } as unknown as PrismaTx;

    await attendanceMarkMutation.resolve({ status: "late", note: "Traffic" }, context([]), tx);

    const call = (tx as unknown as { attendanceRecord: { upsert: jest.Mock } }).attendanceRecord.upsert.mock.calls[0][0];
    expect(call.create.note).toBe("Traffic");
    expect(call.update.note).toBe("Traffic");
  });
});

describe("attendance.correct — input validation", () => {
  it("rejects a future date", () => {
    const future = new Date(Date.now() + 7 * 86400_000);
    const result = attendanceCorrectMutation.inputSchema.safeParse({ userId: "u2", date: future, status: "present" });
    expect(result.success).toBe(false);
  });

  it("accepts today or a past date", () => {
    const past = new Date(Date.now() - 86400_000);
    const result = attendanceCorrectMutation.inputSchema.safeParse({ userId: "u2", date: past, status: "present" });
    expect(result.success).toBe(true);
  });
});

describe("attendance.correct — authorization", () => {
  it("throws ForbiddenException when the actor has no attendance:update grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(attendanceCorrectMutation.resolve({ userId: "u2", date: new Date(), status: "present" }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("throws ForbiddenException for self-correction without an attendance:update grant (attendance:create:own alone is not enough)", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(attendanceCorrectMutation.resolve({ userId: "u1", date: new Date(), status: "present" }, context(["attendance:create:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("self-correction succeeds without a department lookup once the actor holds attendance:update", async () => {
    const tx = {
      user: { findFirst: jest.fn() },
      attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) },
    } as unknown as PrismaTx;

    await attendanceCorrectMutation.resolve({ userId: "u1", date: new Date(), status: "present" }, context(["attendance:update:department"], "d1"), tx);

    expect((tx as unknown as { user: { findFirst: jest.Mock } }).user.findFirst).not.toHaveBeenCalled();
    expect((tx as unknown as { attendanceRecord: { upsert: jest.Mock } }).attendanceRecord.upsert).toHaveBeenCalled();
  });

  it("a department-scoped actor (Department Head) can correct a same-department report", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "d1" }) },
      attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await attendanceCorrectMutation.resolve({ userId: "u2", date: new Date(), status: "absent" }, context(["attendance:update:department"], "d1"), tx);

    expect((tx as unknown as { attendanceRecord: { upsert: jest.Mock } }).attendanceRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: "u2", status: "absent", markedById: "u1" }) }),
    );
  });

  it("a department-scoped actor is rejected correcting a sibling-department user", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "sibling" }) } } as unknown as PrismaTx;
    await expect(
      attendanceCorrectMutation.resolve({ userId: "u2", date: new Date(), status: "absent" }, context(["attendance:update:department"], "d1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("a department-subtree-scoped actor (Executive) can correct within their subtree", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]),
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "grandchild" }) },
      attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await attendanceCorrectMutation.resolve({ userId: "u2", date: new Date(), status: "present" }, context(["attendance:update:department-subtree"], "root"), tx);

    expect((tx as unknown as { attendanceRecord: { upsert: jest.Mock } }).attendanceRecord.upsert).toHaveBeenCalled();
  });

  it("a department-subtree-scoped actor is rejected correcting outside their subtree", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]),
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "unrelated" }) },
    } as unknown as PrismaTx;
    await expect(
      attendanceCorrectMutation.resolve({ userId: "u2", date: new Date(), status: "present" }, context(["attendance:update:department-subtree"], "root"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("throws NotFoundException when the target user doesn't exist or is cross-tenant/deleted", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(attendanceCorrectMutation.resolve({ userId: "ghost", date: new Date(), status: "present" }, context(["attendance:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("attendance.correct — notifications", () => {
  it("notifies the corrected user exactly once when correcting someone else", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "d1" }) },
      attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await attendanceCorrectMutation.resolve({ userId: "u2", date: new Date(), status: "late" }, context(["attendance:update:department"], "d1"), tx);

    const mocks = tx as unknown as { notification: { create: jest.Mock } };
    expect(mocks.notification.create).toHaveBeenCalledTimes(1);
    expect(mocks.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u2", type: "attendance.corrected" }) }));
  });

  it("does not notify on self-correction", async () => {
    const tx = {
      attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: "a1" }) },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    await attendanceCorrectMutation.resolve({ userId: "u1", date: new Date(), status: "present" }, context(["attendance:update:tenant"]), tx);

    expect((tx as unknown as { notification: { create: jest.Mock } }).notification.create).not.toHaveBeenCalled();
  });
});
