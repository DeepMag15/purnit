import { collapsePermissions } from "../../rbac/permission-collapse";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

jest.mock("../tasks/tasks.data-sources", () => ({ tasksWhere: jest.fn() }));
jest.mock("../leave/leave.data-sources", () => ({
  leaveRequestsPendingApprovalsDataSource: { name: "leaveRequests.pendingApprovals", requiredPermission: "leave:approve", resolve: jest.fn() },
}));
jest.mock("../calendar/calendar.data-sources", () => ({ calendarListDataSource: { name: "calendar.list", resolve: jest.fn() } }));

import { gatherDigestData, buildDigestSummary, type DigestRawData } from "./digest-content";
import { tasksWhere } from "../tasks/tasks.data-sources";
import { leaveRequestsPendingApprovalsDataSource } from "../leave/leave.data-sources";
import { calendarListDataSource } from "../calendar/calendar.data-sources";

function ctx(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("gatherDigestData", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  beforeEach(() => {
    jest.clearAllMocks();
    (calendarListDataSource.resolve as jest.Mock).mockResolvedValue([]);
    (tasksWhere as jest.Mock).mockResolvedValue(null);
  });

  it("returns every category empty when the caller has no task:read/leave:approve grant and no calendar items", async () => {
    const tx = { task: { findMany: jest.fn() } } as unknown as PrismaTx;
    const raw = await gatherDigestData(tx, ctx(), now);
    expect(raw).toEqual<DigestRawData>({ overdueTasks: [], dueSoonTasks: [], pendingApprovals: [], todayEvents: [], weekEvents: [] });
  });

  it("calls tasksWhere with {overdue: true, assigneeId} for the overdue query and {assigneeId} for the due-soon base, merging its own date range on top for due-soon", async () => {
    (tasksWhere as jest.Mock).mockResolvedValue({ tenantId: "t1", assigneeId: "u1" });
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { task: { findMany } } as unknown as PrismaTx;

    await gatherDigestData(tx, ctx(), now);

    expect((tasksWhere as jest.Mock).mock.calls[0]).toEqual([tx, expect.any(Object), { overdue: true, assigneeId: "u1" }]);
    expect((tasksWhere as jest.Mock).mock.calls[1]).toEqual([tx, expect.any(Object), { assigneeId: "u1" }]);

    const dueSoonCall = findMany.mock.calls[1][0];
    expect(dueSoonCall.where).toMatchObject({
      tenantId: "t1",
      assigneeId: "u1",
      dueDate: { gte: now, lte: new Date(now.getTime() + 3 * 86_400_000) },
      status: { not: "done" },
    });
  });

  it("regression: always passes its own ctx.userId as assigneeId, even for a caller whose task:read scope is tenant-wide — a personal digest must never leak every tenant task just because the caller happens to have broad visibility", async () => {
    (tasksWhere as jest.Mock).mockResolvedValue(null);
    const tx = { task: { findMany: jest.fn() } } as unknown as PrismaTx;

    await gatherDigestData(tx, ctx(), now);

    for (const call of (tasksWhere as jest.Mock).mock.calls) {
      expect((call[2] as { assigneeId?: string }).assigneeId).toBe("u1");
    }
  });

  it("skips leaveRequestsPendingApprovalsDataSource entirely when the caller lacks leave:approve — never called, not just empty", async () => {
    const tx = { task: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    await gatherDigestData(tx, ctx([]), now);
    expect(leaveRequestsPendingApprovalsDataSource.resolve).not.toHaveBeenCalled();
  });

  it("calls leaveRequestsPendingApprovalsDataSource and joins requester display names when the caller holds leave:approve", async () => {
    (leaveRequestsPendingApprovalsDataSource.resolve as jest.Mock).mockResolvedValue([
      { id: "lr1", userId: "u2", startDate: new Date("2026-08-20"), endDate: new Date("2026-08-21") },
    ]);
    const tx = {
      task: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", displayName: "Jane Doe" }]) },
    } as unknown as PrismaTx;

    const raw = await gatherDigestData(tx, ctx(["leave:approve:tenant"]), now);

    expect(raw.pendingApprovals).toEqual([
      { id: "lr1", requesterName: "Jane Doe", startDate: new Date("2026-08-20"), endDate: new Date("2026-08-21") },
    ]);
  });

  it("falls back to 'Unknown' for a requester whose User row is somehow missing", async () => {
    (leaveRequestsPendingApprovalsDataSource.resolve as jest.Mock).mockResolvedValue([
      { id: "lr1", userId: "ghost", startDate: new Date("2026-08-20"), endDate: new Date("2026-08-21") },
    ]);
    const tx = {
      task: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    const raw = await gatherDigestData(tx, ctx(["leave:approve:tenant"]), now);
    expect(raw.pendingApprovals[0]!.requesterName).toBe("Unknown");
  });

  it("filters itemType 'task' out of the calendar bucket — already covered by the dedicated task queries", async () => {
    (calendarListDataSource.resolve as jest.Mock).mockResolvedValue([
      { id: "m1", itemType: "meeting", title: "Standup", start: new Date("2026-08-19T13:00:00Z"), end: null, meta: {} },
      { id: "tk1", itemType: "task", title: "A task", start: new Date("2026-08-19T15:00:00Z"), end: null, meta: {} },
    ]);
    const tx = { task: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;

    const raw = await gatherDigestData(tx, ctx(), now);
    const allEvents = [...raw.todayEvents, ...raw.weekEvents];
    expect(allEvents).toHaveLength(1);
    expect(allEvents[0]!.id).toBe("m1");
  });

  it("buckets a same-day event into todayEvents and a later one into weekEvents", async () => {
    (calendarListDataSource.resolve as jest.Mock).mockResolvedValue([
      { id: "today1", itemType: "meeting", title: "Standup", start: new Date("2026-08-19T18:00:00Z"), end: null, meta: {} },
      { id: "later1", itemType: "calendarEvent", title: "Offsite", start: new Date("2026-08-22T09:00:00Z"), end: null, meta: {} },
    ]);
    const tx = { task: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;

    const raw = await gatherDigestData(tx, ctx(), now);
    expect(raw.todayEvents.map((e) => e.id)).toEqual(["today1"]);
    expect(raw.weekEvents.map((e) => e.id)).toEqual(["later1"]);
  });
});

describe("buildDigestSummary", () => {
  const empty: DigestRawData = { overdueTasks: [], dueSoonTasks: [], pendingApprovals: [], todayEvents: [], weekEvents: [] };

  it("is empty when every category is empty, with a blank body", () => {
    const summary = buildDigestSummary(empty);
    expect(summary.isEmpty).toBe(true);
    expect(summary.body).toBe("");
  });

  it("is not empty when exactly one category has an item, and singularizes correctly", () => {
    const summary = buildDigestSummary({ ...empty, overdueTasks: [{ id: "t1", title: "Report", dueDate: new Date("2026-08-18") }] });
    expect(summary.isEmpty).toBe(false);
    expect(summary.overdueTasks).toEqual({ count: 1, items: [{ id: "t1", label: "Report", when: new Date("2026-08-18").toISOString() }] });
    expect(summary.body).toBe("1 task overdue");
  });

  it("pluralizes correctly for more than one item", () => {
    const summary = buildDigestSummary({
      ...empty,
      overdueTasks: [
        { id: "t1", title: "A", dueDate: new Date("2026-08-18") },
        { id: "t2", title: "B", dueDate: new Date("2026-08-17") },
      ],
    });
    expect(summary.body).toBe("2 tasks overdue");
  });

  it("caps items shown at 5 per category, while count reflects the true total", () => {
    const overdueTasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, dueDate: new Date("2026-08-18") }));
    const summary = buildDigestSummary({ ...empty, overdueTasks });
    expect(summary.overdueTasks.count).toBe(8);
    expect(summary.overdueTasks.items).toHaveLength(5);
    expect(summary.body).toBe("8 tasks overdue");
  });

  it("combines every non-empty category into one summary line, in a fixed order", () => {
    const summary = buildDigestSummary({
      overdueTasks: [{ id: "t1", title: "A", dueDate: new Date() }],
      dueSoonTasks: [{ id: "t2", title: "B", dueDate: new Date() }],
      pendingApprovals: [{ id: "lr1", requesterName: "Jane", startDate: new Date(), endDate: new Date() }],
      todayEvents: [{ id: "e1", title: "Standup", start: new Date() }],
      weekEvents: [{ id: "e2", title: "Offsite", start: new Date() }],
    });
    expect(summary.body).toBe("1 task overdue · 1 due soon · 1 leave request awaiting your approval · 1 event today · 1 more this week");
  });

  it("labels a leave approval item with the requester's name", () => {
    const summary = buildDigestSummary({
      ...empty,
      pendingApprovals: [{ id: "lr1", requesterName: "Jane Doe", startDate: new Date("2026-08-20"), endDate: new Date("2026-08-21") }],
    });
    expect(summary.pendingApprovals.items[0]!.label).toBe("Jane Doe — leave request");
  });
});
