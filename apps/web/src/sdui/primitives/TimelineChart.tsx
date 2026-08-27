import { z } from "zod";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const TimelineChartSchema = z.object({
  title: z.string().optional(),
  labelKey: z.string().default("label"),
  startKey: z.string().default("start"),
  endKey: z.string().default("end"),
});
type Props = z.infer<typeof TimelineChartSchema>;

interface Row {
  [key: string]: unknown;
}

const COLORS = ["var(--color-accent)"];
const axisStyle = { fontSize: 12, fill: "var(--color-text-muted)" };
const tooltipStyle = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

// recharts' Formatter type is generic over value/name types that don't
// structurally match this chart's own numeric-ms values — same loose-
// extraction precedent as Chart.tsx's handleSegmentClick.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts tooltip formatter payload shape, see comment above
function durationTooltipFormatter(value: any, name: any) {
  return name === "duration" ? [`${Math.round(Number(value) / 3_600_000)}h`, "Duration"] : [null, null];
}

/** A horizontal [start, end]-ranged bar per row — the standard recharts
 * range-bar trick: a transparent "offset" segment (time from the earliest
 * row's start) stacked under a visible "duration" segment, on a
 * `layout="vertical"` BarChart. Read-only (Part 20 §20.2/§20.4's decision)
 * — the interactive drag-to-reschedule Gantt widget (Phase G) is a distinct,
 * later build sharing this same rendering approach. */
export function TimelineChart({ title, labelKey, startKey, endKey, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const rows = Array.isArray(data) ? (data as Row[]) : [];

  const parsed = rows
    .map((r) => ({ label: String(r[labelKey] ?? ""), start: new Date(r[startKey] as string).getTime(), end: new Date(r[endKey] as string).getTime() }))
    .filter((r) => !Number.isNaN(r.start) && !Number.isNaN(r.end));

  const minTime = parsed.length > 0 ? Math.min(...parsed.map((p) => p.start)) : 0;
  const transformed = parsed.map((p) => ({ label: p.label, offset: p.start - minTime, duration: Math.max(p.end - p.start, 60_000) }));

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-52 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (transformed.length === 0 ? (
          <EmptyStateView message="Nothing scheduled." />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, transformed.length * 40)}>
            <BarChart layout="vertical" data={transformed} margin={{ left: 8 }}>
              <XAxis type="number" tick={axisStyle} tickFormatter={(ms: number) => `+${Math.round(ms / 3_600_000)}h`} />
              <YAxis type="category" dataKey="label" width={140} tick={axisStyle} />
              <Tooltip contentStyle={tooltipStyle} formatter={durationTooltipFormatter} />
              <Bar dataKey="offset" stackId="a" fill="transparent" />
              <Bar dataKey="duration" stackId="a" fill={COLORS[0]} radius={[4, 4, 4, 4]} />
            </BarChart>
          </ResponsiveContainer>
        ))}
      </CardBody>
    </Card>
  );
}
