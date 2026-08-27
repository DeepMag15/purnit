import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { hasRequiredPermission } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { tasksWhere } from "../tasks/tasks.data-sources";
import { leaveRequestsPendingApprovalsDataSource } from "../leave/leave.data-sources";
import { calendarListDataSource, type CalendarItem } from "../calendar/calendar.data-sources";

const DUE_SOON_WINDOW_DAYS = 3;
const CALENDAR_WINDOW_DAYS = 7;
const MAX_ITEMS_PER_CATEGORY = 5;

interface DigestTask {
  id: string;
  title: string;
  dueDate: Date;
}

interface DigestLeaveApproval {
  id: string;
  requesterName: string;
  startDate: Date;
  endDate: Date;
}

interface DigestEvent {
  id: string;
  title: string;
  start: Date;
}

export interface DigestRawData {
  overdueTasks: DigestTask[];
  dueSoonTasks: DigestTask[];
  pendingApprovals: DigestLeaveApproval[];
  todayEvents: DigestEvent[];
  weekEvents: DigestEvent[];
}

/**
 * Gathers this user's digest content by reusing the platform's real,
 * already-RBAC-scoped data sources — never reimplementing their query
 * logic. `ctx` must be built fresh per user via
 * `PermissionResolverService.resolveEffectivePermissionsWithTx`, the same
 * recipe `DataSourcesController`/`aiToolCall.confirm` already use outside a
 * real HTTP request; never cached across users or ticks.
 */
export async function gatherDigestData(tx: PrismaTx, ctx: DataSourceContext, now: Date): Promise<DigestRawData> {
  // Overdue tasks — tasksWhere's own existing overdue branch, unmodified,
  // but with an explicit `assigneeId: ctx.userId` narrowing. Live
  // verification against the real demo tenants caught this: "assigned to
  // me" is only a floor for the "own"/department-subtree/team-or-department
  // scope tiers (each folds `{assigneeId: ctx.userId}` into an OR) — the
  // "tenant" tier (see tasksWhere's own branch) has no such floor and
  // returns literally every task in the tenant unless the caller passes
  // `assigneeId` explicitly, which every Alder Financial user's real digest
  // was doing before this fix (all 6 users, from a Billing Clerk to the
  // Finance Director, saw the *same* tenant-wide overdue list). That's the
  // right behavior for `calendarListDataSource`'s own `tasksWhere(tx, ctx,
  // {})` call below (a shared team calendar legitimately shows everyone's
  // due dates) but wrong for a digest whose entire premise — "your daily
  // digest," the per-user opt-out — is personal, not a team broadcast.
  // `tasksWhere`'s own doc comment already documents `assigneeId` as a
  // pure-narrowing param safe to pass at any scope tier.
  const overdueWhere = await tasksWhere(tx, ctx, { overdue: true, assigneeId: ctx.userId });
  const overdueTasksRaw = overdueWhere ? await tx.task.findMany({ where: overdueWhere, orderBy: { dueDate: "asc" }, take: 50 }) : [];
  const overdueTasks: DigestTask[] = overdueTasksRaw.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate! }));

  // Due-soon tasks — tasksWhere's base scope (also narrowed to `ctx.userId`,
  // same reasoning as overdue above) with an extra date range merged on top,
  // the same merge-on-top pattern calendarListDataSource already uses
  // against tasksWhere's own returned where-clause. Disjoint from "overdue"
  // by construction (dueDate < now vs. dueDate >= now).
  const baseWhere = await tasksWhere(tx, ctx, { assigneeId: ctx.userId });
  const dueSoonEnd = new Date(now.getTime() + DUE_SOON_WINDOW_DAYS * 86_400_000);
  const dueSoonTasksRaw = baseWhere
    ? await tx.task.findMany({
        where: { ...baseWhere, dueDate: { gte: now, lte: dueSoonEnd }, status: { not: "done" } },
        orderBy: { dueDate: "asc" },
        take: 50,
      })
    : [];
  const dueSoonTasks: DigestTask[] = dueSoonTasksRaw.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate! }));

  // Pending leave approvals — leaveRequestsPendingApprovalsDataSource throws
  // ForbiddenException for a caller with no leave:approve grant at any
  // scope, the common case for most users in a background loop over every
  // user. Presence-checked first, the same gate DataSourcesController
  // itself runs before ever calling a gated resolve().
  let pendingApprovals: DigestLeaveApproval[] = [];
  if (hasRequiredPermission(leaveRequestsPendingApprovalsDataSource, ctx.effective)) {
    const rows = (await leaveRequestsPendingApprovalsDataSource.resolve({}, ctx, tx)) as Array<{
      id: string;
      userId: string;
      startDate: Date;
      endDate: Date;
    }>;
    const requesterIds = [...new Set(rows.map((r) => r.userId))];
    const requesters = requesterIds.length
      ? await tx.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, displayName: true } })
      : [];
    const nameById = new Map(requesters.map((u) => [u.id, u.displayName]));
    pendingApprovals = rows.map((r) => ({ id: r.id, requesterName: nameById.get(r.userId) ?? "Unknown", startDate: r.startDate, endDate: r.endDate }));
  }

  // Calendar — one rolling window via the real, unmodified
  // calendarListDataSource, bucketed below into today vs. rest-of-week.
  // itemType "task" is filtered out deliberately: task due-dates are
  // already covered by the dedicated overdue/due-soon queries above —
  // including them here too would double-represent the same task in two
  // sections of one digest.
  const calendarEnd = new Date(now.getTime() + CALENDAR_WINDOW_DAYS * 86_400_000);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const calendarItems = (await calendarListDataSource.resolve({ from: now, to: calendarEnd }, ctx, tx)) as CalendarItem[];
  const nonTaskItems = calendarItems.filter((i) => i.itemType !== "task");
  const todayEvents: DigestEvent[] = nonTaskItems.filter((i) => i.start < todayEnd).map((i) => ({ id: i.id, title: i.title, start: i.start }));
  const weekEvents: DigestEvent[] = nonTaskItems.filter((i) => i.start >= todayEnd).map((i) => ({ id: i.id, title: i.title, start: i.start }));

  return { overdueTasks, dueSoonTasks, pendingApprovals, todayEvents, weekEvents };
}

export interface DigestCategorySummary {
  count: number;
  items: Array<{ id: string; label: string; when: string }>;
}

export interface DigestSummary {
  isEmpty: boolean;
  overdueTasks: DigestCategorySummary;
  dueSoonTasks: DigestCategorySummary;
  pendingApprovals: DigestCategorySummary;
  todayEvents: DigestCategorySummary;
  weekEvents: DigestCategorySummary;
  title: string;
  body: string;
}

function summarize<T>(rows: T[], label: (row: T) => string, when: (row: T) => string, id: (row: T) => string): DigestCategorySummary {
  // `count` is the true total (drives the one-line summary text); `items`
  // is capped — the digest lists at most MAX_ITEMS_PER_CATEGORY per
  // section, never the whole set.
  return { count: rows.length, items: rows.slice(0, MAX_ITEMS_PER_CATEGORY).map((r) => ({ id: id(r), label: label(r), when: when(r) })) };
}

/**
 * Pure — no `tx`, no I/O, directly unit-testable. The single source of
 * truth feeding both the in-app Notification's `data`/`title`/`body` and
 * the digest email; `isEmpty` is computed once here, not duplicated at any
 * call site.
 */
export function buildDigestSummary(raw: DigestRawData): DigestSummary {
  const overdueTasks = summarize(
    raw.overdueTasks,
    (t) => t.title,
    (t) => t.dueDate.toISOString(),
    (t) => t.id,
  );
  const dueSoonTasks = summarize(
    raw.dueSoonTasks,
    (t) => t.title,
    (t) => t.dueDate.toISOString(),
    (t) => t.id,
  );
  const pendingApprovals = summarize(
    raw.pendingApprovals,
    (r) => `${r.requesterName} — leave request`,
    (r) => `${r.startDate.toISOString()}–${r.endDate.toISOString()}`,
    (r) => r.id,
  );
  const todayEvents = summarize(
    raw.todayEvents,
    (e) => e.title,
    (e) => e.start.toISOString(),
    (e) => e.id,
  );
  const weekEvents = summarize(
    raw.weekEvents,
    (e) => e.title,
    (e) => e.start.toISOString(),
    (e) => e.id,
  );

  const isEmpty = [overdueTasks, dueSoonTasks, pendingApprovals, todayEvents, weekEvents].every((c) => c.count === 0);

  const parts: string[] = [];
  if (overdueTasks.count) parts.push(`${overdueTasks.count} task${overdueTasks.count === 1 ? "" : "s"} overdue`);
  if (dueSoonTasks.count) parts.push(`${dueSoonTasks.count} due soon`);
  if (pendingApprovals.count) parts.push(`${pendingApprovals.count} leave request${pendingApprovals.count === 1 ? "" : "s"} awaiting your approval`);
  if (todayEvents.count) parts.push(`${todayEvents.count} event${todayEvents.count === 1 ? "" : "s"} today`);
  if (weekEvents.count) parts.push(`${weekEvents.count} more this week`);

  return { isEmpty, overdueTasks, dueSoonTasks, pendingApprovals, todayEvents, weekEvents, title: "Your daily digest", body: parts.join(" · ") };
}
