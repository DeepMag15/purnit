import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  leaveCapabilitiesDataSource,
  leaveTypesListDataSource,
  leaveRequestsListDataSource,
  leaveRequestsPendingApprovalsDataSource,
  leaveBalancesListDataSource,
  leaveWhere,
} from "./leave.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("leave.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("both false with no grants at all", async () => {
    const result = await leaveCapabilitiesDataSource.resolve({}, context([]), tx);
    expect(result).toEqual({ canApprove: false, canManageTypes: false });
  });

  it("canApprove true at any granted scope, including :own", async () => {
    const result = await leaveCapabilitiesDataSource.resolve({}, context(["leave:approve:own"]), tx);
    expect(result).toEqual({ canApprove: true, canManageTypes: false });
  });

  it("canManageTypes true only with leave:manageTypes", async () => {
    const result = await leaveCapabilitiesDataSource.resolve({}, context(["leave:manageTypes:tenant"]), tx);
    expect(result).toEqual({ canApprove: false, canManageTypes: true });
  });
});

describe("leaveTypes.list", () => {
  it("returns non-deleted types for the tenant with no permission gate", async () => {
    const tx = { leaveType: { findMany: jest.fn().mockResolvedValue([{ id: "lt1", name: "Vacation" }]) } } as unknown as PrismaTx;
    const result = await leaveTypesListDataSource.resolve({}, context([]), tx);
    expect(result).toEqual([{ id: "lt1", name: "Vacation" }]);
  });
});

describe("leaveRequests.list", () => {
  it("returns own requests with no scope check needed", async () => {
    const tx = { leaveRequest: { findMany: jest.fn().mockResolvedValue([{ id: "lr1" }]) } } as unknown as PrismaTx;
    const result = await leaveRequestsListDataSource.resolve({}, context(["leave:read:own"]), tx);
    expect(result).toEqual([{ id: "lr1" }]);
    expect((tx as unknown as { leaveRequest: { findMany: jest.Mock } }).leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", userId: "u1" } }),
    );
  });

  it("throws ForbiddenException with no leave:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(leaveRequestsListDataSource.resolve({}, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("a department-scoped actor can view a same-department report's requests", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "d1" }) },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([{ id: "lr1" }]) },
    } as unknown as PrismaTx;
    const result = await leaveRequestsListDataSource.resolve({ userId: "u2" }, context(["leave:read:department"], "d1"), tx);
    expect(result).toEqual([{ id: "lr1" }]);
  });

  it("rejects viewing a sibling-department user's requests", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "sibling" }) } } as unknown as PrismaTx;
    await expect(leaveRequestsListDataSource.resolve({ userId: "u2" }, context(["leave:read:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("throws NotFoundException for an unknown target user", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(leaveRequestsListDataSource.resolve({ userId: "ghost" }, context(["leave:read:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });
});

describe("leaveRequests.pendingApprovals", () => {
  it("includes requests where the actor is the direct approver even with only :own granted", async () => {
    const tx = {
      leaveRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: "lr1" }]) // direct
          .mockResolvedValueOnce([{ id: "lr1", userId: "u2" }]), // final join
      },
    } as unknown as PrismaTx;

    const result = await leaveRequestsPendingApprovalsDataSource.resolve({}, context(["leave:approve:own"]), tx);
    expect(result).toEqual([{ id: "lr1", userId: "u2" }]);
  });

  it("unions the direct-approver path with the override-visibility path for a department-scoped actor, without duplicates", async () => {
    const tx = {
      leaveRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: "lr1" }]) // direct
          .mockResolvedValueOnce([{ id: "lr1" }, { id: "lr2" }]) // override (lr1 overlaps)
          .mockResolvedValueOnce([{ id: "lr1" }, { id: "lr2" }]), // final join
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2" }, { id: "u3" }]) },
    } as unknown as PrismaTx;

    await leaveRequestsPendingApprovalsDataSource.resolve({}, context(["leave:approve:department"], "d1"), tx);

    const finalCall = (tx as unknown as { leaveRequest: { findMany: jest.Mock } }).leaveRequest.findMany.mock.calls[2][0];
    expect(finalCall.where.id.in).toHaveLength(2);
    expect(finalCall.where.id.in).toEqual(expect.arrayContaining(["lr1", "lr2"]));
  });

  it("throws ForbiddenException with no leave:approve grant", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(leaveRequestsPendingApprovalsDataSource.resolve({}, context([]), tx)).rejects.toThrow(ForbiddenException);
  });
});

describe("leaveBalances.list", () => {
  it("computes a default balance from the leave type's defaultAnnualDays when no row has been provisioned yet", async () => {
    const tx = {
      leaveType: { findMany: jest.fn().mockResolvedValue([{ id: "lt1", name: "Vacation", defaultAnnualDays: 20 }]) },
      leaveBalance: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    const result = await leaveBalancesListDataSource.resolve({}, context(["leave:read:own"]), tx);
    expect(result).toEqual([{ leaveTypeId: "lt1", leaveTypeName: "Vacation", year: expect.any(Number), allottedDays: 20, usedDays: 0 }]);
  });

  it("returns the real row's values once one has been provisioned", async () => {
    const tx = {
      leaveType: { findMany: jest.fn().mockResolvedValue([{ id: "lt1", name: "Vacation", defaultAnnualDays: 20 }]) },
      leaveBalance: { findMany: jest.fn().mockResolvedValue([{ leaveTypeId: "lt1", allottedDays: 20, usedDays: 7 }]) },
    } as unknown as PrismaTx;

    const result = (await leaveBalancesListDataSource.resolve({}, context(["leave:read:own"]), tx)) as { allottedDays: number; usedDays: number }[];
    expect(result[0]).toMatchObject({ allottedDays: 20, usedDays: 7 });
  });
});

describe("leaveWhere (AI RAG Phase C)", () => {
  it("returns null with no leave:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await leaveWhere(tx, context([]))).toBeNull();
  });

  it("scopes to only the actor's own requests at :own", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await leaveWhere(tx, context(["leave:read:own"]))).toEqual({ tenantId: "t1", userId: "u1" });
  });

  it("scopes to the department roster at :department, always including the actor's own id", async () => {
    const tx = { user: { findMany: jest.fn().mockResolvedValue([{ id: "u2" }]) } } as unknown as PrismaTx;
    const result = await leaveWhere(tx, context(["leave:read:department"], "d1"));
    expect(result).toEqual({ tenantId: "t1", userId: { in: expect.arrayContaining(["u1", "u2"]) } });
  });

  it("merges caller-supplied extra filters", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await leaveWhere(tx, context(["leave:read:own"]), { status: "pending" });
    expect(result).toEqual({ tenantId: "t1", userId: "u1", status: "pending" });
  });
});
