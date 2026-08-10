"use client";

import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { useRenderContext } from "../render-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Badge } from "../../ui/Badge";
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

function KanbanCard({ row, labelKey, draggable }: { row: Row; labelKey: string; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id, disabled: !draggable });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={`rounded-md border border-border bg-surface p-2.5 text-sm text-text ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}
    >
      {String(row[labelKey] ?? "")}
    </div>
  );
}

function KanbanColumn({ id, cards, labelKey, draggable }: { id: string; cards: Row[]; labelKey: string; draggable: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg border border-border p-2.5 transition-colors duration-150 ${isOver ? "bg-surface-hover" : "bg-surface-elevated"}`}
    >
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{id}</span>
        <Badge tone="neutral">{cards.length}</Badge>
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
 * every other Analytics widget already gives. */
export function KanbanBoard({ title, groupKey, labelKey, columns, updateMutation, updateValueKey, bind, actions }: Props & CommonRenderProps) {
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

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load board: {error}</Alert>}
        {!loading && !error && rows.length === 0 && <EmptyStateView message="No items yet." />}
        {!loading && !error && rows.length > 0 && (
          <DndContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-1">
              {columns.map((col) => (
                <KanbanColumn key={col} id={col} cards={rows.filter((r) => r[groupKey] === col)} labelKey={labelKey} draggable={canDrag} />
              ))}
            </div>
          </DndContext>
        )}
      </CardBody>
    </Card>
  );
}
