import { collapsePermissions } from "../../rbac/permission-collapse";
import { calendarEventsWhere, calendarListDataSource } from "./calendar.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

const FROM = new Date("2026-08-01T00:00:00.000Z");
const TO = new Date("2026-08-31T23:59:59.000Z");

describe("calendarEventsWhere", () => {
  it("author floor plus tenant-wide broadcasts only, for a user with no department", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await calendarEventsWhere(tx, context([], null), FROM, TO);
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      startAt: { gte: FROM, lte: TO },
      OR: [{ authorId: "u1" }, { isPrivate: false, departmentId: null }],
    });
  });

  it("widens with the reader's own department when it has no ancestors (a root department)", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "d1" }]) } as unknown as PrismaTx;
    const where = await calendarEventsWhere(tx, context([], "d1"), FROM, TO);
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      startAt: { gte: FROM, lte: TO },
      OR: [{ authorId: "u1" }, { isPrivate: false, departmentId: null }, { isPrivate: false, departmentId: { in: ["d1"] } }],
    });
  });

  it("widens with the reader's full ancestor chain for a nested department", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "grandchild" }, { id: "child" }, { id: "root" }]) } as unknown as PrismaTx;
    const where = await calendarEventsWhere(tx, context([], "grandchild"), FROM, TO);
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      startAt: { gte: FROM, lte: TO },
      OR: [
        { authorId: "u1" },
        { isPrivate: false, departmentId: null },
        { isPrivate: false, departmentId: { in: ["grandchild", "child", "root"] } },
      ],
    });
  });
});

describe("calendar.list — aggregation", () => {
  it("merges meetings and calendar events, tags by itemType, sorts by start; skips tasks with no task:read grant", async () => {
    const tx = {
      meeting: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "m1", title: "Standup", scheduledStart: new Date("2026-08-10T09:00:00Z"), scheduledEnd: new Date("2026-08-10T09:30:00Z"), organizerId: "u1", cancelledAt: null },
          ]),
      },
      calendarEvent: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "e1", title: "Holiday", startAt: new Date("2026-08-05T00:00:00Z"), endAt: null, authorId: "u1", isPrivate: true, departmentId: null },
          ]),
      },
      task: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve({ from: FROM, to: TO }, context([], null), tx)) as Array<{ id: string; itemType: string }>;

    expect((tx as unknown as { task: { findMany: jest.Mock } }).task.findMany).not.toHaveBeenCalled();
    expect(items.map((i) => i.id)).toEqual(["e1", "m1"]); // e1 (Aug 5) sorts before m1 (Aug 10)
    expect(items[0]).toMatchObject({ itemType: "calendarEvent", title: "Holiday" });
    expect(items[1]).toMatchObject({ itemType: "meeting", title: "Standup" });
  });

  it("includes tasks with a non-null dueDate in range when the actor holds task:read", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: {
        findMany: jest.fn().mockResolvedValue([{ id: "tk1", title: "Report due", dueDate: new Date("2026-08-07T00:00:00Z"), assigneeId: "u1", status: "todo", priority: "high" }]),
      },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve({ from: FROM, to: TO }, context(["task:read:own"], null), tx)) as Array<{
      id: string;
      itemType: string;
      meta: Record<string, unknown>;
    }>;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "tk1", itemType: "task", title: "Report due", meta: { assigneeId: "u1", status: "todo", priority: "high" } });
    const call = (tx as unknown as { task: { findMany: jest.Mock } }).task.findMany.mock.calls[0][0];
    expect(call.where.dueDate).toEqual({ gte: FROM, lte: TO });
  });

  // Healthcare Domain, Phase B — appointments as calendar.list's 4th source type.
  it("skips appointments entirely with no appointment:read grant, no crash, never touches tx.appointment", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    const items = await calendarListDataSource.resolve({ from: FROM, to: TO }, context([], null), tx);
    expect(items).toEqual([]);
  });

  it("includes appointments in range when the actor holds appointment:read, tagged and titled by patient name", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "a1",
            patientId: "p1",
            patient: { name: "Jane Doe" },
            doctorId: "d1",
            scheduledStart: new Date("2026-08-15T10:00:00Z"),
            scheduledEnd: new Date("2026-08-15T10:30:00Z"),
            status: "scheduled",
          },
        ]),
      },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve({ from: FROM, to: TO }, context(["appointment:read:tenant"], null), tx)) as Array<{
      id: string;
      itemType: string;
      title: string;
      meta: Record<string, unknown>;
    }>;

    expect(items).toEqual([
      {
        id: "a1",
        itemType: "appointment",
        title: "Jane Doe",
        start: new Date("2026-08-15T10:00:00Z"),
        end: new Date("2026-08-15T10:30:00Z"),
        meta: { patientId: "p1", doctorId: "d1", status: "scheduled" },
      },
    ]);
    const call = (tx as unknown as { appointment: { findMany: jest.Mock } }).appointment.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ tenantId: "t1", scheduledStart: { gte: FROM, lte: TO } });
  });

  it("sorts a mix of all four item types by start time together", async () => {
    const tx = {
      meeting: {
        findMany: jest.fn().mockResolvedValue([{ id: "m1", title: "Standup", scheduledStart: new Date("2026-08-20T09:00:00Z"), scheduledEnd: new Date("2026-08-20T09:30:00Z"), organizerId: "u1", cancelledAt: null }]),
      },
      calendarEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: "e1", title: "Holiday", startAt: new Date("2026-08-05T00:00:00Z"), endAt: null, authorId: "u1", isPrivate: true, departmentId: null }]),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([{ id: "tk1", title: "Report due", dueDate: new Date("2026-08-25T00:00:00Z"), assigneeId: "u1", status: "todo", priority: "high" }]),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a1", patientId: "p1", patient: { name: "Jane Doe" }, doctorId: "u1", scheduledStart: new Date("2026-08-15T10:00:00Z"), scheduledEnd: new Date("2026-08-15T10:30:00Z"), status: "scheduled" },
        ]),
      },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve(
      { from: FROM, to: TO },
      context(["task:read:own", "appointment:read:own"], null),
      tx,
    )) as Array<{ id: string }>;

    expect(items.map((i) => i.id)).toEqual(["e1", "a1", "m1", "tk1"]);
  });

  // Education Domain, Phase B — assignment due dates as calendar.list's 5th source type.
  it("skips assignments entirely with no assignment:read grant, no crash, never touches tx.assignment", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    const items = await calendarListDataSource.resolve({ from: FROM, to: TO }, context([], null), tx);
    expect(items).toEqual([]);
  });

  it("includes assignments due in range when the actor holds assignment:read, tagged and titled by title + course name", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "as1",
            courseId: "c1",
            course: { name: "Algebra I" },
            title: "Homework 1",
            dueDate: new Date("2026-08-12T00:00:00Z"),
            maxScore: 100,
          },
        ]),
      },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve({ from: FROM, to: TO }, context(["assignment:read:tenant"], null), tx)) as Array<{
      id: string;
      itemType: string;
      title: string;
      meta: Record<string, unknown>;
    }>;

    expect(items).toEqual([
      {
        id: "as1",
        itemType: "assignmentDue",
        title: "Homework 1 — Algebra I",
        start: new Date("2026-08-12T00:00:00Z"),
        end: null,
        meta: { courseId: "c1", maxScore: 100 },
      },
    ]);
    const call = (tx as unknown as { assignment: { findMany: jest.Mock } }).assignment.findMany.mock.calls[0]![0];
    expect(call.where.dueDate).toEqual({ gte: FROM, lte: TO });
  });

  it("excludes an assignment with a null dueDate, same as the task branch's own precedent", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
      assignment: {
        findMany: jest.fn().mockResolvedValue([{ id: "as1", courseId: "c1", course: { name: "Algebra I" }, title: "No due date yet", dueDate: null, maxScore: 100 }]),
      },
    } as unknown as PrismaTx;

    const items = await calendarListDataSource.resolve({ from: FROM, to: TO }, context(["assignment:read:tenant"], null), tx);
    expect(items).toEqual([]);
  });

  it("sorts a mix of all five item types by start time together", async () => {
    const tx = {
      meeting: {
        findMany: jest.fn().mockResolvedValue([{ id: "m1", title: "Standup", scheduledStart: new Date("2026-08-20T09:00:00Z"), scheduledEnd: new Date("2026-08-20T09:30:00Z"), organizerId: "u1", cancelledAt: null }]),
      },
      calendarEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: "e1", title: "Holiday", startAt: new Date("2026-08-05T00:00:00Z"), endAt: null, authorId: "u1", isPrivate: true, departmentId: null }]),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([{ id: "tk1", title: "Report due", dueDate: new Date("2026-08-25T00:00:00Z"), assigneeId: "u1", status: "todo", priority: "high" }]),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a1", patientId: "p1", patient: { name: "Jane Doe" }, doctorId: "u1", scheduledStart: new Date("2026-08-15T10:00:00Z"), scheduledEnd: new Date("2026-08-15T10:30:00Z"), status: "scheduled" },
        ]),
      },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "as1", courseId: "c1", course: { name: "Algebra I" }, title: "Homework 1", dueDate: new Date("2026-08-12T00:00:00Z"), maxScore: 100 },
        ]),
      },
      // Only consulted because this test grants assignment:read:own, which
      // resolves transitively through teacherOwnedCourseIds — see
      // courses.data-sources.ts's own doc comment for why.
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve(
      { from: FROM, to: TO },
      context(["task:read:own", "appointment:read:own", "assignment:read:own"], null),
      tx,
    )) as Array<{ id: string }>;

    expect(items.map((i) => i.id)).toEqual(["e1", "as1", "a1", "m1", "tk1"]);
  });

  // Finance Domain, Phase B — invoice due dates as calendar.list's 6th source type.
  it("skips invoices entirely with no invoice:read grant, no crash, never touches tx.invoice", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    const items = await calendarListDataSource.resolve({ from: FROM, to: TO }, context([], null), tx);
    expect(items).toEqual([]);
  });

  it("includes invoices due in range when the actor holds invoice:read, tagged and titled by client name", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "i1",
            clientId: "c1",
            client: { name: "Acme Co" },
            dueDate: new Date("2026-08-18T00:00:00Z"),
            total: 105000,
            status: "sent",
          },
        ]),
      },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve({ from: FROM, to: TO }, context(["invoice:read:tenant"], null), tx)) as Array<{
      id: string;
      itemType: string;
      title: string;
      meta: Record<string, unknown>;
    }>;

    expect(items).toEqual([
      {
        id: "i1",
        itemType: "invoiceDue",
        title: "Invoice — Acme Co",
        start: new Date("2026-08-18T00:00:00Z"),
        end: null,
        meta: { clientId: "c1", total: 105000, status: "sent" },
      },
    ]);
    const call = (tx as unknown as { invoice: { findMany: jest.Mock } }).invoice.findMany.mock.calls[0]![0];
    expect(call.where.dueDate).toEqual({ gte: FROM, lte: TO });
  });

  it("narrows to only the Sales Rep's own clients' invoices at :own scope, via salesRepOwnedClientIds — never widened to every client", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      // Only consulted because this test grants invoice:read:own, which
      // resolves transitively through salesRepOwnedClientIds — see
      // clients.data-sources.ts's own doc comment for why.
      client: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
    } as unknown as PrismaTx;

    await calendarListDataSource.resolve({ from: FROM, to: TO }, context(["invoice:read:own"], null), tx);

    expect((tx as unknown as { client: { findMany: jest.Mock } }).client.findMany).toHaveBeenCalled();
    const call = (tx as unknown as { invoice: { findMany: jest.Mock } }).invoice.findMany.mock.calls[0]![0];
    expect(call.where.clientId).toEqual({ in: ["c1"] });
  });

  it("sorts a mix of all six item types by start time together", async () => {
    const tx = {
      meeting: {
        findMany: jest.fn().mockResolvedValue([{ id: "m1", title: "Standup", scheduledStart: new Date("2026-08-20T09:00:00Z"), scheduledEnd: new Date("2026-08-20T09:30:00Z"), organizerId: "u1", cancelledAt: null }]),
      },
      calendarEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: "e1", title: "Holiday", startAt: new Date("2026-08-05T00:00:00Z"), endAt: null, authorId: "u1", isPrivate: true, departmentId: null }]),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([{ id: "tk1", title: "Report due", dueDate: new Date("2026-08-25T00:00:00Z"), assigneeId: "u1", status: "todo", priority: "high" }]),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "a1", patientId: "p1", patient: { name: "Jane Doe" }, doctorId: "u1", scheduledStart: new Date("2026-08-15T10:00:00Z"), scheduledEnd: new Date("2026-08-15T10:30:00Z"), status: "scheduled" },
        ]),
      },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: "as1", courseId: "c1", course: { name: "Algebra I" }, title: "Homework 1", dueDate: new Date("2026-08-12T00:00:00Z"), maxScore: 100 },
        ]),
      },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: "i1", clientId: "cl1", client: { name: "Acme Co" }, dueDate: new Date("2026-08-18T00:00:00Z"), total: 105000, status: "sent" },
        ]),
      },
      client: { findMany: jest.fn().mockResolvedValue([{ id: "cl1" }]) },
    } as unknown as PrismaTx;

    const items = (await calendarListDataSource.resolve(
      { from: FROM, to: TO },
      context(["task:read:own", "appointment:read:own", "assignment:read:own", "invoice:read:own"], null),
      tx,
    )) as Array<{ id: string }>;

    expect(items.map((i) => i.id)).toEqual(["e1", "as1", "a1", "i1", "m1", "tk1"]);
  });

  // Platform UI/UX Redesign, Phase F — Dashboard's "Upcoming" widget binds
  // with no from/to at all (a blueprint can't compute "today" at authoring
  // time), so omitting both must fall back to a rolling window server-side.
  it("defaults to a rolling today-to-+14-day window when from/to are both omitted", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    await calendarListDataSource.resolve({}, context([], null), tx);

    const call = (tx as unknown as { meeting: { findMany: jest.Mock } }).meeting.findMany.mock.calls[0]![0];
    const { gte: from, lte: to } = call.where.scheduledStart;
    const now = new Date();
    expect(from.getFullYear()).toBe(now.getFullYear());
    expect(from.getMonth()).toBe(now.getMonth());
    expect(from.getDate()).toBe(now.getDate());
    expect(from.getHours()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("still honors explicit from/to when both are given, unchanged from before Phase F", async () => {
    const tx = {
      meeting: { findMany: jest.fn().mockResolvedValue([]) },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findMany: jest.fn() },
    } as unknown as PrismaTx;

    await calendarListDataSource.resolve({ from: FROM, to: TO }, context([], null), tx);

    const call = (tx as unknown as { meeting: { findMany: jest.Mock } }).meeting.findMany.mock.calls[0]![0];
    expect(call.where.scheduledStart).toEqual({ gte: FROM, lte: TO });
  });
});
