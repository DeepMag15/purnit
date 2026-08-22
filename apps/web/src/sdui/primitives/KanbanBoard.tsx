"use client";

import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { useRenderContext } from "../render-context";
import { StatusDot, type StatusTone } from "../../ui/StatusDot";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";
import { useToast } from "../../ui/Toast";

export const KanbanBoardSchema = z.object({
  title: z.string().optional(),
  groupKey: z.string().default("status"),
  labelKey: z.string().default("title"),
  columns: z.array(z.string()).min(1),
  updateMutation: z.string(),
  updateValueKey: z.string().default("status"),
});
type Props = z.infer<typeof KanbanBoardSchema>;

interface Row {
  id: string;
  [key: string]: unknown;
}

/* Frontend Redesign, post-Phase 03 amendment — matched to reference_design.png's
 * own To-do/In progress/In review/Complete board exactly: pixel-sampled, its 4
 * column dots are violet/amber/blue/green — the same 4 hues StatusDot's own
 * queued/progress/review/done tones were already chosen to mirror (see
 * StatusDot.tsx). `columns` is an arbitrary per-module status-string list with
 * no shared vocabulary across callers (todo/in_progress/done for Tasks,
 * planning/active/completed for Projects, ordered/received for Purchase
 * Orders, ...), so tone is derived positionally rather than by string match:
 * the first column is always "queued" (backlog/not-started) and the last is
 * always "done" (terminal/complete) — the two endpoints every module's status
 * list agrees on — with columns in between interpolated through
 * progress/review by relative position. For exactly 4 columns this reproduces
 * the reference's own tone sequence exactly. */
const TONE_SEQUENCE: StatusTone[] = ["queued", "progress", "review", "done"];
function toneForColumn(index: number, total: number): StatusTone {
  if (total <= 1) return "done";
  const fraction = index / (total - 1);
  return TONE_SEQUENCE[Math.round(fraction * (TONE_SEQUENCE.length - 1))] ?? "done";
}

// Every caller passes a raw status slug ("in_progress", "no-show") as both
// the column id (grouping/drag-target key, unchanged) and, before this, the
// literal rendered label too. reference_design.png's own headers ("In
// progress", "Complete") are clean Title-Case-first-word — this only affects
// display, `id` itself still drives grouping/`updateMutation` untouched.
function formatColumnLabel(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function KanbanCard({ row, labelKey, draggable }: { row: Row; labelKey: string; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={`rounded-lg border border-border bg-surface p-3 text-sm text-text transition-colors duration-[var(--duration-fast)] ${draggable ? "interactive-lift cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}
    >
      {String(row[labelKey] ?? "")}
    </div>
  );
}

function KanbanColumn({ id, tone, cards, labelKey, draggable }: { id: string; tone: StatusTone; cards: Row[]; labelKey: string; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-3 rounded-lg p-2 transition-colors duration-[var(--duration-fast)] ${isOver ? "bg-surface-hover" : ""}`}
    >
      <div className="flex items-center gap-1.5 px-1 py-1">
        <StatusDot tone={tone} />
        <span className="text-[13px] font-medium text-text">{formatColumnLabel(id)}</span>
        <span className="text-[13px] text-text-muted">{cards.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {cards.map((row) => (
          <KanbanCard key={row.id} row={row} labelKey={labelKey} draggable={draggable} />
        ))}
      </div>
    </div>
  );
}

/** A generic drag-and-drop board — bindable to any list-shaped data source,
 * grouped into fixed columns by `groupKey`, dragging a card between columns
 * calls `updateMutation` with `{id, [updateValueKey]: newColumn}`. Analytics
 * Phase G (Interactive Kanban & Gantt) — the first SDUI primitive that
 * triggers a mutation from a drag gesture rather than a click; the first use
 * of `@dnd-kit/core` in this codebase.
 *
 * Permission gating reuses `TaskList.tsx`'s own established `actions`-
 * presence pattern: `updateMutation` only survives into `actions` if the
 * config engine's own permission-pruning kept it, so `canDrag` here is a
 * read of an already-authorized decision, not a second check. A viewer
 * without the grant still sees every card grouped correctly — just not
 * draggable — "prune the capability, not the widget," the same guarantee
 * every other Analytics widget already gives.
 *
 * Frontend Redesign, post-Phase 03 amendment — the `<Card><CardHeader
 * title/></Card>` box this used to render itself in is gone: all 10 real
 * call sites (Projects, Tasks, and 8 domain workspaces) already render their
 * own `PageHeader` above the board and never pass `title`, so the box was
 * always an empty, redundant frame — and reference_design.png's own board
 * sits directly on the page background with no boxed container at all.
 * `title` stays in the schema (harmless, unused) rather than being a
 * breaking prop removal. */
export function KanbanBoard({ groupKey, labelKey, columns, updateMutation, updateValueKey, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch, queryKey } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const queryClient = useQueryClient();
  const toast = useToast();

  const canDrag = actions?.some((a) => a.kind === "mutation" && a.mutation === updateMutation) ?? false;
  const rows = Array.isArray(data) ? (data as Row[]) : [];

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const cardId = String(active.id);
    const newColumn = String(over.id);
    const card = rows.find((r) => r.id === cardId);
    if (!card || card[groupKey] === newColumn) return;

    // Same optimistic-update-then-rollback-on-error shape as
    // TaskList.tsx's handleStatusChange — duplicated as a pattern, not
    // shared, the same small-piece-of-logic precedent AnalyticsDashboard's
    // own autoLayout duplication already set.
    const previous = queryClient.getQueryData<Row[]>(queryKey);
    queryClient.setQueryData<Row[]>(queryKey, (current) => current?.map((r) => (r.id === cardId ? { ...r, [groupKey]: newColumn } : r)));
    try {
      await callMutation(updateMutation, { id: cardId, [updateValueKey]: newColumn });
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      toast.show(err instanceof Error ? err.message : "Couldn't move card", "danger");
    } finally {
      refetch();
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <Alert tone="danger">Couldn&apos;t load board: {error}</Alert>;
  if (rows.length === 0) return <EmptyStateView message="No items yet." />;

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex gap-6 overflow-x-auto pb-1">
        {columns.map((col, i) => (
          <KanbanColumn
            key={col}
            id={col}
            tone={toneForColumn(i, columns.length)}
            cards={rows.filter((r) => r[groupKey] === col)}
            labelKey={labelKey}
            draggable={canDrag}
          />
        ))}
      </div>
    </DndContext>
  );
}
