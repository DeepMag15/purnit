"use client";

import { useDataSourceQuery } from "../../../sdui/use-data-binding";
import { Card, CardHeader, CardBody, Icon, StatusDot } from "../../../ui";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Alert } from "../../../ui/Alert";
import { EmptyStateView } from "../../../sdui/primitives/EmptyState";
import { CALENDAR_ITEM_TONE, CALENDAR_ITEM_ICON, type CalendarItemType } from "../../../lib/calendar-item-style";

interface CalendarItem {
  id: string;
  itemType: CalendarItemType;
  title: string;
  start: string;
  end: string | null;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today · ${time}`;
  if (isTomorrow) return `Tomorrow · ${time}`;
  return `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

/**
 * Frontend Redesign, Phase 01 — reuses `calendar.list` verbatim (already an
 * ungated, cross-domain aggregator spanning meetings/events/task due dates/
 * appointments/assignments/invoices/work orders/purchase orders — see that
 * data source's own doc comment). One widget works unchanged across all 5
 * industries because the aggregation already happened server-side.
 */
export function AgendaWidget() {
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { data, isPending, error } = useDataSourceQuery<CalendarItem[]>("calendar.list", { from: from.toISOString(), to: to.toISOString() });
  const items = (Array.isArray(data) ? data : []).slice(0, 6);

  return (
    <Card>
      <CardHeader title="Agenda — next 7 days" />
      <CardBody className="flex flex-col gap-1">
        {isPending && <SkeletonRows rows={3} />}
        {!isPending && error && <Alert tone="danger">Couldn&apos;t load your agenda.</Alert>}
        {!isPending && !error && items.length === 0 && <EmptyStateView icon="event_available" message="Nothing on your calendar this week." />}
        {!isPending &&
          !error &&
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-md border-t border-border px-1.5 py-2.5 transition-colors duration-[var(--duration-fast)] first:border-t-0 hover:bg-surface-hover"
            >
              <Icon name={CALENDAR_ITEM_ICON[item.itemType]} size={16} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-text">{item.title}</span>
              <StatusDot tone={CALENDAR_ITEM_TONE[item.itemType]} />
              <span className="shrink-0 text-xs text-text-muted">{formatWhen(item.start)}</span>
            </div>
          ))}
      </CardBody>
    </Card>
  );
}
