import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { attendanceListDataSource, attendanceRosterDataSource } from "./attendance.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-08-31T23:59:59.000Z");

describe("attendance.list", () => {
  it("throws ForbiddenException when the actor has no attendance:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(attendanceListDataSource.resolve({ from: FROM, to: TO }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("no userId param resolves to the actor's own history, no scope check needed", async () => {
    const tx = { attendanceRecord: { findMany: jest.fn().mockResolvedValue([{ id: "a1", userId: "u1" }]) } } as unknown as PrismaTx;
    const result = (await attendanceListDataSource.resolve({ from: FROM, to: TO }, context(["attendance:read:own"]), tx)) as { roster: unknown[]; records: unknown[] };
    expect(result.records).toHaveLength(1);
    const call = (tx as unknown as { attendanceRecord: { findMany: jest.Mock } }).attendanceRecord.findMany.mock.calls[0][0];
    expect(call.where.userId).toBe("u1");
  });

  it("userId === ctx.userId resolves the same self path, regardless of granted scope", async () => {
    const tx = { attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    await attendanceListDataSource.resolve({ userId: "u1", from: FROM, to: TO }, context(["attendance:read:own"]), tx);
    const call = (tx as unknown as { attendanceRecord: { findMany: jest.Mock } }).attendanceRecord.findMany.mock.calls[0][0];
    expect(call.where.userId).toBe("u1");
  });

  it("rejects an other-user drill-down when the actor's scope is only own", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(attendanceListDataSource.resolve({ userId: "u2", from: FROM, to: TO }, context(["attendance:read:own"]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("a department-scoped actor can view a same-department user's history", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "d1" }) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;
    await expect(attendanceListDataSource.resolve({ userId: "u2", from: FROM, to: TO }, context(["attendance:read:department"], "d1"), tx)).resolves.toBeDefined();
  });

  it("a department-scoped actor is rejected viewing a sibling-department user's history", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: "u2", departmentId: "sibling" }) } } as unknown as PrismaTx;
    await expect(attendanceListDataSource.resolve({ userId: "u2", from: FROM, to: TO }, context(["attendance:read:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("throws NotFoundException for a nonexistent/cross-tenant target user", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(attendanceListDataSource.resolve({ userId: "ghost", from: FROM, to: TO }, context(["attendance:read:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });
});

describe("attendance.roster", () => {
  it("throws ForbiddenException when the actor has no attendance:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(attendanceRosterDataSource.resolve({ from: FROM, to: TO }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("own scope has no team to roster — returns empty", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = (await attendanceRosterDataSource.resolve({ from: FROM, to: TO }, context(["attendance:read:own"]), tx)) as { roster: unknown[]; records: unknown[] };
    expect(result).toEqual({ roster: [], records: [] });
  });

  it("department scope resolves the roster from the actor's own department only", async () => {
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Me", departmentId: "d1" }, { id: "u2", displayName: "Report", departmentId: "d1" }]) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await attendanceRosterDataSource.resolve({ from: FROM, to: TO }, context(["attendance:read:department"], "d1"), tx);

    const userCall = (tx as unknown as { user: { findMany: jest.Mock } }).user.findMany.mock.calls[0][0];
    expect(userCall.where.departmentId).toEqual({ in: ["d1"] });
  });

  it("department-subtree scope resolves the roster from the whole subtree", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]),
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Me", departmentId: "root" }]) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await attendanceRosterDataSource.resolve({ from: FROM, to: TO }, context(["attendance:read:department-subtree"], "root"), tx);

    const userCall = (tx as unknown as { user: { findMany: jest.Mock } }).user.findMany.mock.calls[0][0];
    expect(userCall.where.departmentId).toEqual({ in: ["root", "grandchild"] });
  });

  it("tenant scope resolves every tenant user, unfiltered by department", async () => {
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }, { id: "u3" }]) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await attendanceRosterDataSource.resolve({ from: FROM, to: TO }, context(["attendance:read:tenant"]), tx);

    const userCall = (tx as unknown as { user: { findMany: jest.Mock } }).user.findMany.mock.calls[0][0];
    expect(userCall.where.tenantId).toBe("t1");
    expect(userCall.where.departmentId).toBeUndefined();
  });
});
