import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { leaveTypeCreateMutation, leaveSubmitMutation, leaveApproveMutation, leaveRejectMutation, leaveCancelMutation } from "./leave.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("leaveType.create", () => {
  it("creates a leave type scoped to the tenant", async () => {
    const tx = { leaveType: { create: jest.fn().mockResolvedValue({ id: "lt1" }) } } as unknown as PrismaTx;
    await leaveTypeCreateMutation.resolve({ name: "Vacation", defaultAnnualDays: 20 }, context(["leave:manageTypes:tenant"]), tx);
    expect((tx as unknown as { leaveType: { create: jest.Mock } }).leaveType.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", name: "Vacation", defaultAnnualDays: 20 },
    });
  });
});

describe("leave.submit", () => {
  it("computes business days excluding weekends and resolves the approver from managerId", async () => {
    const tx = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: "lt1", name: "Vacation", defaultAnnualDays: 20 }) },
      leaveBalance: { upsert: jest.fn().mockResolvedValue({ allottedDays: 20, usedDays: 0 }) },
      user: { findFirst: jest.fn().mockResolvedValue({ managerId: "m1" }) },
      leaveRequest: { create: jest.fn().mockResolvedValue({ id: "lr1" }) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    // Mon 2026-08-17 through Fri 2026-08-21 — 5 business days, no weekend in range.
    await leaveSubmitMutation.resolve(
      { leaveTypeId: "lt1", startDate: new Date("2026-08-17"), endDate: new Date("2026-08-21") },
      context(["leave:create:own"]),
      tx,
    );

    const createCall = (tx as unknown as { leaveRequest: { create: jest.Mock } }).leaveRequest.create.mock.calls[0][0];
    expect(createCall.data.daysRequested).toBe(5);
    expect(createCall.data.approverId).toBe("m1");

    const notifyCall = (tx as unknown as { notification: { create: jest.Mock } }).notification.create.mock.calls[0][0];
    expect(notifyCall.data).toMatchObject({ userId: "m1", type: "leave.submitted" });
  });

  it("excludes a weekend from the business-day count", async () => {
    const tx = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: "lt1", name: "Vacation", defaultAnnualDays: 20 }) },
      leaveBalance: { upsert: jest.fn().mockResolvedValue({ allottedDays: 20, usedDays: 0 }) },
      user: { findFirst: jest.fn().mockResolvedValue({ managerId: null }) },
      leaveRequest: { create: jest.fn().mockResolvedValue({ id: "lr1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    // Fri 2026-08-21 through Mon 2026-08-24 — 2 business days (Fri, Mon), Sat/Sun excluded.
    await leaveSubmitMutation.resolve(
      { leaveTypeId: "lt1", startDate: new Date("2026-08-21"), endDate: new Date("2026-08-24") },
      context(["leave:create:own"]),
      tx,
    );

    const createCall = (tx as unknown as { leaveRequest: { create: jest.Mock } }).leaveRequest.create.mock.calls[0][0];
    expect(createCall.data.daysRequested).toBe(2);
  });

  it("does not notify when the requester has no manager (approverId is null)", async () => {
    const tx = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: "lt1", name: "Vacation", defaultAnnualDays: 20 }) },
      leaveBalance: { upsert: jest.fn().mockResolvedValue({ allottedDays: 20, usedDays: 0 }) },
      user: { findFirst: jest.fn().mockResolvedValue({ managerId: null }) },
      leaveRequest: { create: jest.fn().mockResolvedValue({ id: "lr1" }) },
      notification: { create: jest.fn() },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await leaveSubmitMutation.resolve({ leaveTypeId: "lt1", startDate: new Date("2026-08-17"), endDate: new Date("2026-08-17") }, context(["leave:create:own"]), tx);

    expect((tx as unknown as { notification: { create: jest.Mock } }).notification.create).not.toHaveBeenCalled();
  });

  it("rejects a request that would exceed the remaining balance", async () => {
    const tx = {
      leaveType: { findFirst: jest.fn().mockResolvedValue({ id: "lt1", name: "Vacation", defaultAnnualDays: 5 }) },
      leaveBalance: { upsert: jest.fn().mockResolvedValue({ allottedDays: 5, usedDays: 3 }) },
    } as unknown as PrismaTx;

    // Mon-Fri = 5 business days requested, only 2 remaining (5 allotted - 3 used).
    await expect(
      leaveSubmitMutation.resolve({ leaveTypeId: "lt1", startDate: new Date("2026-08-17"), endDate: new Date("2026-08-21") }, context(["leave:create:own"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for an unknown leave type", async () => {
    const tx = { leaveType: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      leaveSubmitMutation.resolve({ leaveTypeId: "ghost", startDate: new Date("2026-08-17"), endDate: new Date("2026-08-17") }, context(["leave:create:own"]), tx),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("leave.approve/leave.reject — dual-path authorization", () => {
  it("the direct approver can approve regardless of granted scope width (leave:approve:own is the floor)", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", leaveTypeId: "lt1", status: "pending", daysRequested: 3, approverId: "u1", startDate: new Date("2026-08-17") }),
        update: jest.fn().mockResolvedValue({ id: "lr1", status: "approved" }),
      },
      leaveBalance: { update: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await leaveApproveMutation.resolve({ id: "lr1" }, context(["leave:approve:own"]), tx);

    expect((tx as unknown as { leaveRequest: { update: jest.Mock } }).leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "approved", decidedById: "u1" }) }),
    );
    expect((tx as unknown as { leaveBalance: { update: jest.Mock } }).leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usedDays: { increment: 3 } } }),
    );
  });

  it("a Department Head can approve a report's request even when NOT the direct approver (override visibility)", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", leaveTypeId: "lt1", status: "pending", daysRequested: 2, approverId: "someone-else", startDate: new Date("2026-08-17") }),
        update: jest.fn().mockResolvedValue({ id: "lr1", status: "approved" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ departmentId: "d1" }) },
      leaveBalance: { update: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await leaveApproveMutation.resolve({ id: "lr1" }, context(["leave:approve:department"], "d1"), tx);

    expect((tx as unknown as { leaveRequest: { update: jest.Mock } }).leaveRequest.update).toHaveBeenCalled();
  });

  it("rejects an actor who is neither the direct approver nor in scope", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", leaveTypeId: "lt1", status: "pending", daysRequested: 2, approverId: "someone-else", startDate: new Date("2026-08-17") }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ departmentId: "sibling" }) },
    } as unknown as PrismaTx;

    await expect(leaveApproveMutation.resolve({ id: "lr1" }, context(["leave:approve:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects an actor holding only leave:approve:own who is not the direct approver", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", leaveTypeId: "lt1", status: "pending", daysRequested: 2, approverId: "someone-else", startDate: new Date("2026-08-17") }),
      },
    } as unknown as PrismaTx;

    await expect(leaveApproveMutation.resolve({ id: "lr1" }, context(["leave:approve:own"]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("throws BadRequestException when the request has already been decided", async () => {
    const tx = {
      leaveRequest: { findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", status: "approved", approverId: "u1" }) },
    } as unknown as PrismaTx;
    await expect(leaveApproveMutation.resolve({ id: "lr1" }, context(["leave:approve:own"]), tx)).rejects.toThrow(BadRequestException);
  });

  it("leave.reject does not touch the balance", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", leaveTypeId: "lt1", status: "pending", daysRequested: 3, approverId: "u1", startDate: new Date("2026-08-17") }),
        update: jest.fn().mockResolvedValue({ id: "lr1", status: "rejected" }),
      },
      leaveBalance: { update: jest.fn() },
      notification: { create: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await leaveRejectMutation.resolve({ id: "lr1" }, context(["leave:approve:own"]), tx);

    expect((tx as unknown as { leaveBalance: { update: jest.Mock } }).leaveBalance.update).not.toHaveBeenCalled();
  });
});

describe("leave.cancel", () => {
  it("the requester can cancel their own pending request with no balance change", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u1", status: "pending" }),
        update: jest.fn().mockResolvedValue({ id: "lr1", status: "cancelled" }),
      },
      leaveBalance: { update: jest.fn() },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await leaveCancelMutation.resolve({ id: "lr1" }, context([]), tx);

    expect((tx as unknown as { leaveBalance: { update: jest.Mock } }).leaveBalance.update).not.toHaveBeenCalled();
  });

  it("decrements the balance when cancelling an already-approved request", async () => {
    const tx = {
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u1", leaveTypeId: "lt1", status: "approved", daysRequested: 4, startDate: new Date("2026-08-17") }),
        update: jest.fn().mockResolvedValue({ id: "lr1", status: "cancelled" }),
      },
      leaveBalance: { update: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await leaveCancelMutation.resolve({ id: "lr1" }, context([]), tx);

    expect((tx as unknown as { leaveBalance: { update: jest.Mock } }).leaveBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { usedDays: { decrement: 4 } } }),
    );
  });

  it("a non-owner without approval authority cannot cancel someone else's request", async () => {
    const tx = {
      leaveRequest: { findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u2", status: "pending", approverId: "someone-else" }) },
    } as unknown as PrismaTx;

    await expect(leaveCancelMutation.resolve({ id: "lr1" }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("throws BadRequestException when the request is already cancelled", async () => {
    const tx = { leaveRequest: { findFirst: jest.fn().mockResolvedValue({ id: "lr1", userId: "u1", status: "cancelled" }) } } as unknown as PrismaTx;
    await expect(leaveCancelMutation.resolve({ id: "lr1" }, context([]), tx)).rejects.toThrow(BadRequestException);
  });
});
