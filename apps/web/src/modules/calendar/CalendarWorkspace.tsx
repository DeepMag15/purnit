"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { CommonRenderProps } from "../../sdui/registry";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Badge } from "../../ui/Badge";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

export const CalendarWorkspaceSchema = z.object({});
type Props = z.infer<typeof CalendarWorkspaceSchema>;

interface CalendarItem {
  id: string;
  itemType: "meeting" | "calendarEvent" | "task" | "appointment";
  title: string;
  start: string;
  end: string | null;
  meta: Record<string, unknown>;
}

interface DepartmentOption {
  id: string;
  name: string;
}

// Fixed frontend-only vocabulary, same treatment as TaskList's REMINDER_PRESETS.
const REMINDER_PRESETS = [
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

const ITEM_TONE: Record<CalendarItem["itemType"], "info" | "accent" | "warning" | "success"> = {
  meeting: "info",
  calendarEvent: "accent",
  task: "warning",
  // Healthcare Domain, Phase B — read-only here too, same treatment as the
  // other three types (booking/status changes only happen through
  // AppointmentsWorkspace).
  appointment: "success",
};

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
 * Core Workspace Modules, Phase 3, Submodule 1: Calendar & Scheduling — a
 * blueprint-registered composite, mirrors AnnouncementsWorkspace/MeetingsWorkspace's
 * "manages its own data via useDataSourceQuery" shape. `calendarEvent.create`'s
 * presence in `actions` is the only real permission-pruned gate — since
 * every tier holds `calendarEvent:create:own` (seed.ts's role.intern), it's
 * always present; the target selector below decides personal vs. broadcast
 * client-side, never offering a choice the backend would reject.
 * `calendarEvent.delete` visibility is data-driven off each item's
 * `meta.authorId`, same precedent as Announcements' delete button.
 */
export function CalendarWorkspace({ actions }: Props & CommonRenderProps) {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const canCreate = actions?.some((a) => a.kind === "mutation" && a.mutation === "calendarEvent.create") ?? false;
  const canBroadcast = ["Department Head", "Executive", "HR Manager", "Company Admin"].some((r) => user.roles.includes(r));
  const canTargetWholeCompany = user.roles.includes("Company Admin") || user.roles.includes("HR Manager");

  const [view, setView] = useState<"month" | "agenda">("month");
  const [referenceDate, setReferenceDate] = useState(() => new Date());

  const { from, to } = useMemo(() => {
    if (view === "agenda") return { from: startOfDay(new Date()), to: addDays(startOfDay(new Date()), 30) };
    const days = monthGridDays(referenceDate);
    return { from: days[0]!, to: addDays(days[days.length - 1]!, 1) };
  }, [view, referenceDate]);

  const params = { from: from.toISOString(), to: to.toISOString() };
  const { data: itemsData, isPending } = useDataSourceQuery<CalendarItem[]>("calendar.list", params);
  const items = Array.isArray(itemsData) ? itemsData : [];

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
    <Card>
      <CardHeader
        title="Calendar"
        action={
          <div className="flex items-center gap-2">
            <Select value={view} onChange={(e) => setView(e.target.value as "month" | "agenda")} className="h-8 text-xs">
              <option value="month">Month</option>
              <option value="agenda">Agenda</option>
            </Select>
            {canCreate && (
              <Button size="sm" onClick={() => setShowForm((v) => !v)}>
                <Icon name="add" size={14} />
                New Event
              </Button>
            )}
          </div>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {showForm && canCreate && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
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
          </div>
        )}

        {isPending && <SkeletonRows />}

        {!isPending && view === "month" && (
          <MonthGrid
            referenceDate={referenceDate}
            itemsByDay={itemsByDay}
            userId={user.id}
            onPrev={() => setReferenceDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            onNext={() => setReferenceDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            onToday={() => setReferenceDate(new Date())}
            onDelete={handleDelete}
          />
        )}

        {!isPending && view === "agenda" && <AgendaList items={items} userId={user.id} onDelete={handleDelete} />}
      </CardBody>
    </Card>
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
  const monthLabel = referenceDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = startOfDay(new Date()).toDateString();
  const currentMonth = referenceDate.getMonth();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-text">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrev} className="rounded-md p-1 text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
            <Icon name="chevron_left" size={16} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="rounded-md px-2 py-1 text-xs text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
          >
            Today
          </button>
          <button type="button" onClick={onNext} className="rounded-md p-1 text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover">
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-surface px-2 py-1 text-center font-medium text-text-muted">
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
              className={`min-h-20 bg-surface p-1 ${day.getMonth() !== currentMonth ? "opacity-40" : ""} ${key === todayKey ? "ring-1 ring-inset ring-accent" : ""}`}
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

  if (byDay.size === 0) return <EmptyStateView message="Nothing on the calendar in the next 30 days." />;

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
      <div className="truncate" title={item.title}>
        <Badge tone={ITEM_TONE[item.itemType]}>{item.title}</Badge>
      </div>
    );
  }

  const time = new Date(item.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Badge tone={ITEM_TONE[item.itemType]}>{item.itemType === "task" ? "Due" : item.itemType}</Badge>
        <span className="truncate text-sm text-text">{item.title}</span>
        <span className="shrink-0 text-xs text-text-muted">{time}</span>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="shrink-0 text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-danger"
          title="Delete calendar event"
        >
          <Icon name="delete" size={13} />
        </button>
      )}
    </div>
  );
}
