import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  attendanceRateThisMonthMetric,
  attendanceRateByDepartmentMetric,
  attendanceStatusByDepartmentMetric,
  attendanceDepartmentLeaderboardMetric,
} from "./attendance.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("attendance metrics", () => {
  it("both metrics require attendance:read", () => {
    expect(attendanceRateThisMonthMetric.requiredPermission).toBe("attendance:read");
    expect(attendanceRateByDepartmentMetric.requiredPermission).toBe("attendance:read");
  });

  it("attendanceRateThisMonthMetric.computeLive returns 0 with no attendance:read grant, no query issued", async () => {
    const tx = { attendanceRecord: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await attendanceRateThisMonthMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { attendanceRecord: { count: jest.Mock } }).attendanceRecord.count).not.toHaveBeenCalled();
  });

  it("attendanceRateThisMonthMetric.computeLive computes present/total for own scope", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(6);
    const tx = { attendanceRecord: { count: countMock } } as unknown as PrismaTx;
    const value = await attendanceRateThisMonthMetric.computeLive(context(["attendance:read:own"]), tx);
    expect(value).toBe(75);
    expect(countMock.mock.calls[0][0].where.userId).toEqual({ in: ["u1"] });
  });

  it("attendanceRateThisMonthMetric.snapshot.computeDaily returns a tenant-wide row plus one row per department", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(3); // total=4, present=3 -> 75
    const tx = {
      attendanceRecord: {
        count: countMock,
        findMany: jest.fn().mockResolvedValue([
          { userId: "u1", status: "present" },
          { userId: "u2", status: "present" },
          { userId: "u3", status: "present" },
          { userId: "u4", status: "absent" },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "u1", departmentId: "d1" },
          { id: "u2", departmentId: "d1" },
          { id: "u3", departmentId: "d2" },
          { id: "u4", departmentId: "d2" },
        ]),
      },
    } as unknown as PrismaTx;
    const rows = await attendanceRateThisMonthMetric.snapshot!.computeDaily("t1", tx);
    expect(rows).toEqual(
      expect.arrayContaining([
        { departmentId: null, value: 75 },
        { departmentId: "d1", value: 100 },
        { departmentId: "d2", value: 50 },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it("attendanceRateThisMonthMetric.snapshot.computeDaily excludes a departmentless user from every per-department row, but keeps the tenant-wide figure intact", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const tx = {
      attendanceRecord: {
        count: countMock,
        findMany: jest.fn().mockResolvedValue([
          { userId: "u1", status: "present" },
          { userId: "u2", status: "absent" },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "u1", departmentId: null },
          { id: "u2", departmentId: null },
        ]),
      },
    } as unknown as PrismaTx;
    const rows = await attendanceRateThisMonthMetric.snapshot!.computeDaily("t1", tx);
    expect(rows).toEqual([{ departmentId: null, value: 50 }]);
  });

  it("attendanceRateThisMonthMetric.snapshot.computeDaily skips the per-department query entirely when there are zero records today", async () => {
    const tx = {
      attendanceRecord: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() },
      user: { findMany: jest.fn() },
    } as unknown as PrismaTx;
    const rows = await attendanceRateThisMonthMetric.snapshot!.computeDaily("t1", tx);
    expect(rows).toEqual([{ departmentId: null, value: 0 }]);
    expect((tx as unknown as { attendanceRecord: { findMany: jest.Mock } }).attendanceRecord.findMany).not.toHaveBeenCalled();
  });

  it("attendanceRateThisMonthMetric.computeLive narrows a multi-user tenant roster down to a single filtered employee", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }]) },
      attendanceRecord: { count: countMock },
    } as unknown as PrismaTx;
    const value = await attendanceRateThisMonthMetric.computeLive(context(["attendance:read:tenant"]), tx, { employeeId: "u1" });
    expect(value).toBe(40);
    expect(countMock.mock.calls[0][0].where.userId).toEqual({ in: ["u1"] });
  });

  it("attendanceRateThisMonthMetric.computeLive honors an explicit from/to range over the default month-to-date window", async () => {
    const countMock = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const tx = { attendanceRecord: { count: countMock } } as unknown as PrismaTx;
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-31");
    await attendanceRateThisMonthMetric.computeLive(context(["attendance:read:own"]), tx, { from, to });
    expect(countMock.mock.calls[0][0].where.date).toEqual({ gte: from, lte: to });
  });

  it("attendanceRateByDepartmentMetric.computeLive returns [] with no grant", async () => {
    const tx = { user: { findMany: jest.fn() }, attendanceRecord: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await attendanceRateByDepartmentMetric.computeLive(context([]), tx)).toEqual([]);
  });

  it("attendanceRateByDepartmentMetric.computeLive groups present-rate by department name, own scope", async () => {
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", departmentId: "d1" }]) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([{ userId: "u1", status: "present" }, { userId: "u1", status: "absent" }]) },
      department: { findMany: jest.fn().mockResolvedValue([{ id: "d1", name: "Engineering" }]) },
    } as unknown as PrismaTx;
    const rows = await attendanceRateByDepartmentMetric.computeLive(context(["attendance:read:own"]), tx);
    expect(rows).toEqual([{ department: "Engineering", rate: 50 }]);
  });

  it("attendanceStatusByDepartmentMetric requires attendance:read and returns [] with no grant", async () => {
    expect(attendanceStatusByDepartmentMetric.requiredPermission).toBe("attendance:read");
    const tx = { user: { findMany: jest.fn() }, attendanceRecord: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await attendanceStatusByDepartmentMetric.computeLive(context([]), tx)).toEqual([]);
  });

  it("attendanceStatusByDepartmentMetric.computeLive groups attendance status counts by (department, status)", async () => {
    const tx = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "u1", departmentId: "d1" },
          { id: "u2", departmentId: "d1" },
          { id: "u3", departmentId: "d2" },
        ]),
      },
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "u1", status: "present" },
          { userId: "u2", status: "present" },
          { userId: "u2", status: "absent" },
          { userId: "u3", status: "late" },
        ]),
      },
      department: { findMany: jest.fn().mockResolvedValue([{ id: "d1", name: "Engineering" }, { id: "d2", name: "Sales" }]) },
    } as unknown as PrismaTx;
    const rows = await attendanceStatusByDepartmentMetric.computeLive(context(["attendance:read:tenant"]), tx);
    expect(rows).toEqual(
      expect.arrayContaining([
        { department: "Engineering", status: "present", count: 2 },
        { department: "Engineering", status: "absent", count: 1 },
        { department: "Sales", status: "late", count: 1 },
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  it("attendanceDepartmentLeaderboardMetric requires analytics:departmentPerformance, not attendance:read", () => {
    expect(attendanceDepartmentLeaderboardMetric.requiredPermission).toBe("analytics:departmentPerformance");
  });

  it("attendanceDepartmentLeaderboardMetric.computeLive returns real tenant-wide data for a caller with ZERO attendance:read grant — the deliberate scope exception", async () => {
    const tx = {
      attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "u1", status: "present" },
          { userId: "u2", status: "present" },
          { userId: "u2", status: "absent" },
          { userId: "u3", status: "present" },
        ]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "u1", departmentId: "d1" },
          { id: "u2", departmentId: "d1" },
          { id: "u3", departmentId: "d2" },
        ]),
      },
      department: { findMany: jest.fn().mockResolvedValue([{ id: "d1", name: "Engineering" }, { id: "d2", name: "Sales" }]) },
    } as unknown as PrismaTx;
    // No attendance:read at all — only the new permission is checked by
    // isPermissionGranted at the dashboard layer; computeLive itself must
    // still return real data since it never calls scopedUserIds.
    // Engineering: u1 (1 present) + u2 (1 present, 1 absent) = 2/3 present = 66.7%.
    const rows = await attendanceDepartmentLeaderboardMetric.computeLive(context([]), tx);
    expect(rows).toEqual([
      { department: "Sales", rate: 100 },
      { department: "Engineering", rate: 66.7 },
    ]);
  });

  it("attendanceDepartmentLeaderboardMetric.computeLive returns [] with zero records this month, no crash", async () => {
    const tx = { attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    expect(await attendanceDepartmentLeaderboardMetric.computeLive(context([]), tx)).toEqual([]);
  });
});
