import { collapsePermissions } from "../../rbac/permission-collapse";
import { meetingsHeldThisWeekMetric, meetingsTimelineMetric } from "./meetings.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("meetingsHeldThisWeekMetric", () => {
  it("has no requiredPermission — visible to every tenant member, per meetingsWhere's participant floor", () => {
    expect(meetingsHeldThisWeekMetric.requiredPermission).toBeUndefined();
  });

  it("computeLive counts within a 7-day trailing window via meetingsWhere", async () => {
    const tx = { meeting: { count: jest.fn().mockResolvedValue(4) } } as unknown as PrismaTx;
    const value = await meetingsHeldThisWeekMetric.computeLive(context([]), tx);
    expect(value).toBe(4);
    const call = (tx as unknown as { meeting: { count: jest.Mock } }).meeting.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", cancelledAt: null });
    expect(call.where.scheduledStart.gte).toBeInstanceOf(Date);
  });

  it("computeLive layers a departmentId filter onto meetingsWhere's own extra where-clause", async () => {
    const tx = { meeting: { count: jest.fn().mockResolvedValue(1) } } as unknown as PrismaTx;
    await meetingsHeldThisWeekMetric.computeLive(context([]), tx, { departmentId: "d1" });
    const call = (tx as unknown as { meeting: { count: jest.Mock } }).meeting.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ departmentId: "d1" });
  });
});

describe("meetingsTimelineMetric", () => {
  it("has no requiredPermission — same participant-floor precedent as meetingsHeldThisWeekMetric", () => {
    expect(meetingsTimelineMetric.requiredPermission).toBeUndefined();
  });

  it("computeLive maps meetings within a 14-day window to {label, start, end}", async () => {
    const scheduledStart = new Date("2026-08-10T10:00:00Z");
    const scheduledEnd = new Date("2026-08-10T11:00:00Z");
    const tx = {
      meeting: {
        findMany: jest.fn().mockResolvedValue([{ title: "Sprint Planning", scheduledStart, scheduledEnd }]),
      },
    } as unknown as PrismaTx;
    const rows = await meetingsTimelineMetric.computeLive(context([]), tx);
    expect(rows).toEqual([{ label: "Sprint Planning", start: scheduledStart, end: scheduledEnd }]);
    const call = (tx as unknown as { meeting: { findMany: jest.Mock } }).meeting.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ cancelledAt: null });
    expect(call.where.scheduledStart.gte).toBeInstanceOf(Date);
    expect(call.where.scheduledStart.lte).toBeInstanceOf(Date);
  });
});
