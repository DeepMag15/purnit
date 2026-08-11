import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentAncestorIds } from "../../rbac/department-ancestors";
import { meetingsWhere } from "../meetings/meetings.data-sources";
import { tasksWhere } from "../tasks/tasks.data-sources";
import { appointmentsWhere } from "../appointments/appointments.data-sources";
import { assignmentsWhere } from "../assignments/assignments.data-sources";
import { invoicesWhere } from "../invoices/invoices.data-sources";

/**
 * Mirrors `announcementsWhere` exactly: resolves the reader's own ancestor
 * chain once, then `OR`s broadcast rows targeting the tenant (departmentId
 * null) or any ancestor of the reader's department. The `authorId` branch is
 * an always-on floor — same "ownership is a floor, not exclusive" precedent
 * as `meetingsWhere`'s participant floor — so an author always sees their
 * own private entries plus anything they've broadcast, regardless of their
 * current department. Never returns `null` — `calendarEvent:create:own` is a
 * universal grant (see seed.ts's `role.intern`), so every tenant member can
 * always at least see their own entries.
 */
export async function calendarEventsWhere(tx: PrismaTx, ctx: DataSourceContext, from: Date, to: Date): Promise<Record<string, unknown>> {
  const ancestorIds = ctx.userDepartmentId ? await getDepartmentAncestorIds(tx, ctx.tenantId, ctx.userDepartmentId) : [];
  return {
    tenantId: ctx.tenantId,
    deletedAt: null,
    startAt: { gte: from, lte: to },
    OR: [
      { authorId: ctx.userId },
      { isPrivate: false, departmentId: null },
      ...(ancestorIds.length > 0 ? [{ isPrivate: false, departmentId: { in: ancestorIds } }] : []),
    ],
  };
}

interface CalendarItem {
  id: string;
  itemType: "meeting" | "calendarEvent" | "task" | "appointment" | "assignmentDue" | "invoiceDue";
  title: string;
  start: Date;
  end: Date | null;
  meta: Record<string, unknown>;
}

// `from`/`to` are optional (Platform UI/UX Redesign, Phase F) — every
// existing caller (CalendarWorkspace) always passes both explicitly, so this
// is additive. A blueprint-authored widget (Dashboard's "Upcoming" List) has
// no way to compute "today" at seed/authoring time, so omitting both falls
// back to a rolling today→+14-day window, resolved server-side at request
// time instead.
const CalendarListParamsSchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

/**
 * The unified Calendar view — aggregates Meetings, CalendarEvents, and
 * Task due-dates for a bounded date range, tagged by `itemType`. No
 * `requiredPermission` (an ungated aggregator, same shape as
 * `meetingsWhere`/`tasksWhere` being callable from other data sources) —
 * each underlying source enforces its own visibility.
 *
 * Healthcare Domain, Phase B — a fourth branch (Appointments) reuses the
 * exact same structural pattern as the three below: its own dedicated
 * `*Where()` import from a different module, its own raw query (never
 * calling `appointments.list`'s own resolver), pushed into the same shared
 * `items` array. Read-only here, same as every other item type — booking/
 * status changes still only happen through `AppointmentsWorkspace`.
 * Education Domain, Phase B added a fifth branch (Assignment due dates),
 * the identical pattern again. Finance Domain, Phase B added a sixth
 * (Invoice due dates).
 *
 * Deliberately sequential, never `Promise.all` — concurrent queries against
 * one shared transactional `tx` are unsafe (every data-source file in this
 * codebase carries this same warning; see CONTEXT.md §9).
 */
export const calendarListDataSource: DataSourceDefinition<z.infer<typeof CalendarListParamsSchema>> = {
  name: "calendar.list",
  paramsSchema: CalendarListParamsSchema,
  async resolve(params, ctx, tx) {
    const now = new Date();
    const from = params.from ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = params.to ?? new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    const items: CalendarItem[] = [];

    const meetingsWhereClause = await meetingsWhere(tx, ctx, { scheduledStart: { gte: from, lte: to } });
    const meetings = await tx.meeting.findMany({ where: meetingsWhereClause });
    for (const m of meetings) {
      items.push({
        id: m.id,
        itemType: "meeting",
        title: m.title,
        start: m.scheduledStart,
        end: m.scheduledEnd,
        meta: { organizerId: m.organizerId, cancelledAt: m.cancelledAt },
      });
    }

    const eventsWhereClause = await calendarEventsWhere(tx, ctx, from, to);
    const events = await tx.calendarEvent.findMany({ where: eventsWhereClause });
    for (const e of events) {
      items.push({
        id: e.id,
        itemType: "calendarEvent",
        title: e.title,
        start: e.startAt,
        end: e.endAt,
        meta: { authorId: e.authorId, isPrivate: e.isPrivate, departmentId: e.departmentId },
      });
    }

    // Returns null when the actor has no task:read grant at all — skipped,
    // not an error, same "gracefully absent" shape as an unresolved scope
    // anywhere else in this codebase.
    const tasksWhereClause = await tasksWhere(tx, ctx, {});
    if (tasksWhereClause) {
      const tasks = await tx.task.findMany({ where: { ...tasksWhereClause, dueDate: { gte: from, lte: to } } });
      for (const t of tasks) {
        if (!t.dueDate) continue;
        items.push({
          id: t.id,
          itemType: "task",
          title: t.title,
          start: t.dueDate,
          end: null,
          meta: { assigneeId: t.assigneeId, status: t.status, priority: t.priority },
        });
      }
    }

    // Returns null when the actor has no appointment:read grant at all —
    // skipped, not an error, same "gracefully absent" shape as the task
    // branch above.
    const appointmentsWhereClause = await appointmentsWhere(tx, ctx, { scheduledStart: { gte: from, lte: to } });
    if (appointmentsWhereClause) {
      const appointments = await tx.appointment.findMany({ where: appointmentsWhereClause, include: { patient: { select: { name: true } } } });
      for (const a of appointments) {
        items.push({
          id: a.id,
          itemType: "appointment",
          title: a.patient.name,
          start: a.scheduledStart,
          end: a.scheduledEnd,
          meta: { patientId: a.patientId, doctorId: a.doctorId, status: a.status },
        });
      }
    }

    // Education Domain, Phase B — a fifth branch (Assignment due dates),
    // same structural pattern as the appointment branch above (its own
    // dedicated `*Where()` import, its own raw query, pushed into the same
    // shared `items` array). `Assignment.dueDate` is nullable (like
    // `Task.dueDate`, unlike `Appointment.scheduledStart`), so this follows
    // the task branch's null-check pattern rather than the appointment
    // branch's. Read-only here — status/grading changes still only happen
    // through `CourseDetail`'s own Assignments tab.
    const assignmentsWhereClause = await assignmentsWhere(tx, ctx, {});
    if (assignmentsWhereClause) {
      const assignments = await tx.assignment.findMany({
        where: { ...assignmentsWhereClause, dueDate: { gte: from, lte: to } },
        include: { course: { select: { name: true } } },
      });
      for (const a of assignments) {
        if (!a.dueDate) continue;
        items.push({
          id: a.id,
          itemType: "assignmentDue",
          // Assignment already has its own `title` field (unlike Appointment,
          // which had none) — the course name is appended anyway since a
          // bare assignment title floating in a calendar shared across
          // multiple courses would otherwise be ambiguous.
          title: `${a.title} — ${a.course.name}`,
          start: a.dueDate,
          end: null,
          meta: { courseId: a.courseId, maxScore: a.maxScore },
        });
      }
    }

    // Finance Domain, Phase B — a sixth branch (Invoice due dates), same
    // structural pattern as the branches above. `Invoice.dueDate` is
    // NON-nullable (unlike `Task`/`Assignment`), so this follows the
    // appointment branch's shape — the date-range filter goes straight into
    // `invoicesWhere`'s own `extra` param, no null-check loop needed.
    // Invoice has no `title` field of its own, so the client name (a real
    // Prisma relation join, `Invoice.clientId` has an actual FK) is required
    // here, not optional disambiguation the way it was for Assignment.
    // Read-only here — status/payment changes still only happen through
    // InvoiceDetail.
    const invoicesWhereClause = await invoicesWhere(tx, ctx, { dueDate: { gte: from, lte: to } });
    if (invoicesWhereClause) {
      const invoices = await tx.invoice.findMany({ where: invoicesWhereClause, include: { client: { select: { name: true } } } });
      for (const inv of invoices) {
        items.push({
          id: inv.id,
          itemType: "invoiceDue",
          title: `Invoice — ${inv.client.name}`,
          start: inv.dueDate,
          end: null,
          meta: { clientId: inv.clientId, total: inv.total, status: inv.status },
        });
      }
    }

    items.sort((a, b) => a.start.getTime() - b.start.getTime());
    return items;
  },
};
