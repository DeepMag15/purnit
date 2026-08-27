"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Card, CardBody } from "../../ui/Card";
import { PageHeader } from "../../ui/PageHeader";
import { ViewSwitcher } from "../../ui/ViewSwitcher";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { StatusDot } from "../../ui/StatusDot";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { CALENDAR_ITEM_TONE, calendarItemTypeLabel, type CalendarItemType } from "../../lib/calendar-item-style";

export const CalendarWorkspaceSchema = z.object({});

interface CalendarItem {
  id: string;
  itemType: CalendarItemType;
  title: string;
  start: string;
  end: string | null;
  meta: Record<string, unknown>;
}

interface DepartmentOption {
  id: string;
  name: string;
}

interface CalendarCapabilities {
  canCreate: boolean;
  canBroadcast: boolean;
  canTargetWholeCompany: boolean;
}

// Fixed frontend-only vocabulary, same treatment as TaskList's REMINDER_PRESETS.
const REMINDER_PRESETS = [
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const VIEWS = [
  { id: "month", label: "Month", icon: "calendar_month" },
  { id: "agenda", label: "Agenda", icon: "view_agenda" },
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
// Variable-length grid (35 or 42 days depending on the month), padded to
// whole weeks — no library, plain Date arithmetic (see the plan's build-vs-
// buy note: no react-big-calendar/fullcalendar dependency).
function monthGridDays(referenceDate: Date): Date[] {
  const first = startOfMonth(referenceDate);
  const last = endOfMonth(referenceDate);
  const gridStart = addDays(first, -first.getDay());
  const gridEnd = addDays(last, 6 - last.getDay());
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  return days;
}
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Core Workspace Modules, Phase 3, Submodule 1: Calendar & Scheduling.
 *
 * Frontend Redesign, Phase 02 — moved off the SDUI Renderer onto a
 * dedicated route (`/workspace/calendar`, see `WorkspaceSidebar.tsx`'s
 * `hrefForNavItem`). Zero-prop now — `canCreate`/`canBroadcast`/
 * `canTargetWholeCompany` come from the new `calendar.capabilities` data
 * source instead of the `actions` prop the Renderer used to inject, and
 * instead of the two hardcoded role-label checks this file used to run
 * client-side (a real correctness gap: a custom role with the same
 * effective scope but a different label would have been silently denied).
 * Still registered as an SDUI primitive (`register-all.ts`) for the old
 * `/workspace/page.calendar` catch-all path — harmless, unreachable via
 * normal navigation now, not worth the risk of unregistering.
 */
export function CalendarWorkspace() {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: caps, isPending: capsPending } = useDataSourceQuery<CalendarCapabilities>("calendar.capabilities");
  const canCreate = caps?.canCreate ?? false;
  const canBroadcast = caps?.canBroadcast ?? false;
  const canTargetWholeCompany = caps?.canTargetWholeCompany ?? false;

  const [view, setView] = useState<"month" | "agenda">("month");
  const [referenceDate, setReferenceDate] = useState(() => new Date());

  const { from, to } = useMemo(() => {
    if (view === "agenda") return { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 30) };
    const days = monthGridDays(referenceDate);
    return { from: days[0]!, to: addDays(days[days.length - 1]!, 1) };
  }, [view, referenceDate]);

  const params = { from: from.toISOString(), to: to.toISOString() };
  const { data: itemsData, isPending: itemsPending } = useDataSourceQuery<CalendarItem[]>("calendar.list", params);
  const items = Array.isArray(itemsData) ? itemsData : [];
  const isPending = capsPending || itemsPending;

  const { data: departmentsData } = useDataSourceQuery<DepartmentOption[]>("departments.list", {}, { enabled: canCreate && canBroadcast });
  const departments = Array.isArray(departmentsData) ? departmentsData : [];

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(() => toLocalInputValue(new Date(Date.now() + 60 * 60_000)));
  const [end, setEnd] = useState("");
  const [target, setTarget] = useState(""); // "" = personal, "tenant" = whole company, else a departmentId
  const [reminderMinutes, setReminderMinutes] = useState("");
  const [posting, setPosting] = useState(false);

  function invalidateCalendar() {
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("calendar.list", params, tenant.id, user.id) });
  }

  async function handlePost() {
    if (!title.trim()) return;
    setPosting(true);
    try {
      await callMutation("calendarEvent.create", {
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        startAt: new Date(start).toISOString(),
        ...(end ? { endAt: new Date(end).toISOString() } : {}),
        ...(target === "tenant" ? { broadcastTenantWide: true } : {}),
        ...(target && target !== "tenant" ? { departmentId: target } : {}),
        ...(reminderMinutes ? { reminderMinutesBefore: Number(reminderMinutes) } : {}),
      });
      toast.show(`"${title.trim()}" added to the calendar`);
      setTitle("");
      setDescription("");
      setEnd("");
      setTarget("");
      setReminderMinutes("");
      setShowForm(false);
      invalidateCalendar();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't create calendar event", "danger");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await callMutation("calendarEvent.delete", { id });
      invalidateCalendar();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't delete calendar event", "danger");
    }
  }

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = startOfDay(new Date(item.start)).toDateString();
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Calendar"
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Icon name="add" size={14} />
              New Event
            </Button>
          )
        }
        viewSwitcher={<ViewSwitcher views={VIEWS} activeId={view} onChange={(id) => setView(id as "month" | "agenda")} />}
      />

      {showForm && canCreate && (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
            />
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-text-muted">
                Start
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                />
              </label>
              <label className="flex-1 text-xs text-text-muted">
                End (optional)
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                />
              </label>
            </div>
            {canBroadcast && (
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Personal (only me)</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                {canTargetWholeCompany && <option value="tenant">Whole company</option>}
              </Select>
            )}
            <Select value={reminderMinutes} onChange={(e) => setReminderMinutes(e.target.value)}>
              <option value="">No reminder</option>
              {REMINDER_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={handlePost} disabled={posting || !title.trim()} className="w-fit">
              {posting ? "Adding…" : "Add to calendar"}
            </Button>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          {isPending && <SkeletonRows />}

          {!isPending && view === "month" && (
            <>
              {/* Frontend Redesign, Phase 06 — a 7-column month grid has no
                  honest way to stay readable at phone widths (cells shrink
                  to ~45px regardless of padding/font tweaks), so below `md:`
                  this falls back to the same stacked agenda list the
                  "Agenda" view already renders — matches DashboardGrid's own
                  established fork-to-a-list-below-768px precedent, reusing
                  the already-fetched month-range `items` rather than a
                  second fetch. Keeps its own month-nav header (MonthGrid's
                  own prev/today/next controls are inside the hidden grid) so
                  mobile doesn't also lose the ability to page months. */}
              <div className="hidden md:block">
                <MonthGrid
                  referenceDate={referenceDate}
                  itemsByDay={itemsByDay}
                  userId={user.id}
                  onPrev={() => setReferenceDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                  onNext={() => setReferenceDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                  onToday={() => setReferenceDate(new Date())}
                  onDelete={handleDelete}
                />
              </div>
              <div className="flex flex-col gap-2 md:hidden">
                <MonthNavHeader
                  referenceDate={referenceDate}
                  onPrev={() => setReferenceDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                  onNext={() => setReferenceDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                  onToday={() => setReferenceDate(new Date())}
                />
                <AgendaList items={items} userId={user.id} onDelete={handleDelete} />
              </div>
            </>
          )}

          {!isPending && view === "agenda" && <AgendaList items={items} userId={user.id} onDelete={handleDelete} />}
        </CardBody>
      </Card>
    </div>
  );
}

function MonthGrid({
  referenceDate,
  itemsByDay,
  userId,
  onPrev,
  onNext,
  onToday,
  onDelete,
}: {
  referenceDate: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  userId: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDelete: (id: string) => void;
}) {
  const days = useMemo(() => monthGridDays(referenceDate), [referenceDate]);
  const todayKey = startOfDay(new Date()).toDateString();
  const currentMonth = referenceDate.getMonth();

  return (
    <div className="flex flex-col gap-2">
      <MonthNavHeader referenceDate={referenceDate} onPrev={onPrev} onNext={onNext} onToday={onToday} />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-surface-sunk px-2 py-1 text-center font-medium text-text-muted">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = day.toDateString();
          const dayItems = itemsByDay.get(key) ?? [];
          const visible = dayItems.slice(0, 3);
          const overflow = dayItems.length - visible.length;
          return (
            <div
              key={key}
              className={`min-h-20 bg-surface p-1 ${day.getMonth() !== currentMonth ? "opacity-40" : ""} ${key === todayKey ? "bg-surface-sunk ring-1 ring-inset ring-accent/40" : ""}`}
            >
              <div className="mb-1 text-right text-text-muted">{day.getDate()}</div>
              <div className="flex flex-col gap-0.5">
                {visible.map((item) => (
                  <CalendarItemChip key={item.id} item={item} userId={userId} onDelete={onDelete} compact />
                ))}
                {overflow > 0 && <div className="text-[10px] text-text-muted">+{overflow} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Shared by MonthGrid and the Phase 06 mobile agenda fallback (see above) —
// extracted so mobile keeps month-paging even though MonthGrid itself is
// hidden below `md:`.
function MonthNavHeader({
  referenceDate,
  onPrev,
  onNext,
  onToday,
}: {
  referenceDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const monthLabel = referenceDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm font-medium text-text">{monthLabel}</div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onPrev} className="interactive-press rounded-md p-1 text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
          <Icon name="chevron_left" size={16} />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="interactive-press rounded-md px-2 py-1 text-xs text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
        >
          Today
        </button>
        <button type="button" onClick={onNext} className="interactive-press rounded-md p-1 text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
          <Icon name="chevron_right" size={16} />
        </button>
      </div>
    </div>
  );
}

function AgendaList({ items, userId, onDelete }: { items: CalendarItem[]; userId: string; onDelete: (id: string) => void }) {
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of [...items].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())) {
      const key = startOfDay(new Date(item.start)).toDateString();
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [items]);

  if (byDay.size === 0) return <EmptyStateView icon="event_available" message="Nothing on the calendar in the next 30 days." />;

  return (
    <div className="flex flex-col gap-3">
      {[...byDay.entries()].map(([day, dayItems]) => (
        <div key={day}>
          <div className="mb-1 text-xs font-medium text-text-muted">
            {new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </div>
          <div className="flex flex-col gap-1">
            {dayItems.map((item) => (
              <CalendarItemChip key={item.id} item={item} userId={userId} onDelete={onDelete} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarItemChip({
  item,
  userId,
  onDelete,
  compact = false,
}: {
  item: CalendarItem;
  userId: string;
  onDelete: (id: string) => void;
  compact?: boolean;
}) {
  // Meeting join/details live on page.meetings — MeetingsWorkspace keeps
  // owning that (deliberate scope boundary), so a meeting chip here is
  // display-only, no click-through/join logic reimplemented.
  const canDelete = item.itemType === "calendarEvent" && item.meta.authorId === userId;

  if (compact) {
    return (
      <div className="flex items-center gap-1" title={item.title}>
        <StatusDot tone={CALENDAR_ITEM_TONE[item.itemType]} />
        <span className="truncate text-text">{item.title}</span>
      </div>
    );
  }

  const time = new Date(item.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot tone={CALENDAR_ITEM_TONE[item.itemType]} />
        <span className="shrink-0 text-xs uppercase tracking-wide text-text-muted">{calendarItemTypeLabel(item.itemType)}</span>
        <span className="truncate text-sm text-text">{item.title}</span>
        <span className="shrink-0 text-xs text-text-muted">{time}</span>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="interactive-press shrink-0 text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-danger"
          title="Delete calendar event"
        >
          <Icon name="delete" size={13} />
        </button>
      )}
    </div>
  );
}
