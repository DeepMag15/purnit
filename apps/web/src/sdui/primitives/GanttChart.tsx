"use client";

import { useState } from "react";
import { z } from "zod";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, type BarRectangleItem } from "recharts";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { useRenderContext } from "../render-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";
import { useToast } from "../../ui/Toast";

export const GanttChartSchema = z.object({
  title: z.string().optional(),
  labelKey: z.string().default("label"),
  startKey: z.string().default("start"),
  endKey: z.string().default("end"),
  idKey: z.string().default("id"),
  updateMutation: z.string().optional(),
});
type Props = z.infer<typeof GanttChartSchema>;

interface Row {
  [key: string]: unknown;
}

interface Bar_ {
  id: string;
  label: string;
  offset: number;
  duration: number;
  endDate: string;
}

const COLORS = ["var(--color-accent)"];
const axisStyle = { fontSize: 12, fill: "var(--color-text-muted)" };
const tooltipStyle = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts tooltip formatter payload shape, same precedent as TimelineChart.tsx
function durationTooltipFormatter(value: any, name: any) {
  return name === "duration" ? [`${Math.round(Number(value) / 86_400_000)}d`, "Span"] : [null, null];
}

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Reuses `TimelineChart`'s own stacked-transparent-offset-bar rendering
 * trick (a distinct file, per that component's own doc comment, not an
 * in-place extension) but adds click-to-edit: clicking a bar opens an
 * inline due-date editor below the chart, calling `updateMutation` on save.
 *
 * Analytics Phase G — resolved via `AskUserQuestion` in favor of click-to-
 * edit over drag-to-resize: the bar's start edge is always synthetic
 * (derived from `startKey`, e.g. a task's `createdAt` — never itself
 * editable), and a real drag-resize directly on a recharts SVG segment would
 * be a materially riskier, first-of-its-kind interaction for the same
 * end-user outcome ("reschedule from the Gantt view") a plain click+form
 * already delivers. Rows missing `endKey` are excluded entirely — a task
 * with no due date has no bar to draw, a disclosed narrowing, not a bug. */
export function GanttChart({ title, labelKey, startKey, endKey, idKey, updateMutation, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch } = useDataBinding(bind);
  const { callMutation } = useRenderContext();
  const toast = useToast();

  const canEdit = !!updateMutation && (actions?.some((a) => a.kind === "mutation" && a.mutation === updateMutation) ?? false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const parsed = rows
    .map((r) => ({
      id: String(r[idKey] ?? ""),
      label: String(r[labelKey] ?? ""),
      start: new Date(r[startKey] as string).getTime(),
      end: new Date(r[endKey] as string).getTime(),
      endIso: String(r[endKey] ?? ""),
    }))
    .filter((r) => !Number.isNaN(r.start) && !Number.isNaN(r.end));

  const minTime = parsed.length > 0 ? Math.min(...parsed.map((p) => p.start)) : 0;
  const transformed: Bar_[] = parsed.map((p) => ({
    id: p.id,
    label: p.label,
    offset: p.start - minTime,
    duration: Math.max(p.end - p.start, 86_400_000),
    endDate: p.endIso,
  }));

  function handleBarClick(bar: BarRectangleItem) {
    if (!canEdit) return;
    const row = bar.payload as Bar_ | undefined;
    if (!row) return;
    setEditingId(row.id);
    setEditValue(toDateInputValue(row.endDate));
  }

  async function handleSave() {
    if (!editingId || !updateMutation || !editValue) return;
    setSaving(true);
    try {
      await callMutation(updateMutation, { id: editingId, [endKey]: editValue });
      toast.show("Due date updated");
      setEditingId(null);
      refetch();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't update due date", "danger");
    } finally {
      setSaving(false);
    }
  }

  const editingRow = transformed.find((r) => r.id === editingId);

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-3">
        {loading && <Skeleton className="h-52 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (transformed.length === 0 ? (
          <EmptyStateView message="Nothing with a due date yet." />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, transformed.length * 40)}>
            <BarChart layout="vertical" data={transformed} margin={{ left: 8 }}>
              <XAxis type="number" tick={axisStyle} tickFormatter={(ms: number) => `+${Math.round(ms / 86_400_000)}d`} />
              <YAxis type="category" dataKey="label" width={140} tick={axisStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={durationTooltipFormatter} />
              <Bar dataKey="offset" stackId="a" fill="transparent" />
              <Bar
                dataKey="duration"
                stackId="a"
                fill={COLORS[0]}
                radius={[4, 4, 4, 4]}
                style={canEdit ? { cursor: "pointer" } : undefined}
                onClick={handleBarClick}
              />
            </BarChart>
          </ResponsiveContainer>
        ))}
        {editingRow && (
          <Card className="border border-border bg-surface-elevated p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-text">Due date for &quot;{editingRow.label}&quot;:</span>
              <Input type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-40" />
              <Button size="sm" onClick={handleSave} disabled={saving || !editValue}>
                Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </CardBody>
    </Card>
  );
}
