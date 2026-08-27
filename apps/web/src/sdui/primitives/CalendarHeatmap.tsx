import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const CalendarHeatmapSchema = z.object({
  title: z.string().optional(),
  dateKey: z.string().default("date"),
  valueKey: z.string().default("value"),
});
type Props = z.infer<typeof CalendarHeatmapSchema>;

interface Row {
  [key: string]: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return copy;
}

/** A GitHub-contribution-graph-style grid (day rows × week columns) — same
 * hand-built CSS-grid + `color-mix` cell-coloring approach as `Heatmap`,
 * just bucketed onto a date axis instead of two arbitrary categories. */
export function CalendarHeatmap({ title, dateKey, valueKey, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const rows = Array.isArray(data) ? (data as Row[]) : [];

  const parsed = rows
    .map((r) => ({ date: new Date(r[dateKey] as string), value: Number(r[valueKey]) || 0 }))
    .filter((r) => !Number.isNaN(r.date.getTime()));

  let weeks: { date: Date; value: number | undefined }[][] = [];
  let max = 0;
  if (parsed.length > 0) {
    const valueByDay = new Map(parsed.map((r) => [dayKey(r.date), r.value]));
    max = Math.max(...parsed.map((r) => r.value));
    const minDate = new Date(Math.min(...parsed.map((r) => r.date.getTime())));
    const maxDate = new Date(Math.max(...parsed.map((r) => r.date.getTime())));
    const gridStart = startOfWeek(minDate);
    const totalDays = Math.round((maxDate.getTime() - gridStart.getTime()) / DAY_MS) + 1;
    const weekCount = Math.ceil(totalDays / 7);

    weeks = Array.from({ length: weekCount }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const date = new Date(gridStart.getTime() + (w * 7 + d) * DAY_MS);
        return { date, value: valueByDay.get(dayKey(date)) };
      }),
    );
  }

  return (
    <Card className="transition-shadow duration-[var(--duration-fast)] hover:shadow-md">
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (parsed.length === 0 ? (
          <EmptyStateView message="No history yet." />
        ) : (
          <div className="flex gap-1 overflow-x-auto">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((cell, di) => {
                  const intensity = max > 0 && cell.value !== undefined ? Math.round((cell.value / max) * 100) : 0;
                  return (
                    <div
                      key={di}
                      title={cell.value !== undefined ? `${dayKey(cell.date)}: ${cell.value}` : dayKey(cell.date)}
                      className="h-3 w-3 rounded-sm"
                      style={{
                        background: cell.value !== undefined ? `color-mix(in srgb, var(--color-accent) ${intensity}%, transparent)` : "var(--color-surface-hover)",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
