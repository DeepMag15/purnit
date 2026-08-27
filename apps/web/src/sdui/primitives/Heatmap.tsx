import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const HeatmapSchema = z.object({
  title: z.string().optional(),
  rowKey: z.string(),
  colKey: z.string(),
  valueKey: z.string(),
});
type Props = z.infer<typeof HeatmapSchema>;

interface Row {
  [key: string]: unknown;
}

/** Hand-built CSS-grid, no charting library — same "doesn't warrant pulling
 * in a charting library" precedent `KpiCard`'s own `Sparkline` already set.
 * Pivots a flat `{rowKey, colKey, valueKey}` row array into a rowKey ×
 * colKey grid; a missing (row, col) combination renders as an empty cell,
 * not a guessed zero. */
export function Heatmap({ title, rowKey, colKey, valueKey, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const rows = Array.isArray(data) ? (data as Row[]) : [];

  const rowValues = [...new Set(rows.map((r) => String(r[rowKey] ?? "")))];
  const colValues = [...new Set(rows.map((r) => String(r[colKey] ?? "")))];
  const max = rows.reduce((m, r) => Math.max(m, Number(r[valueKey]) || 0), 0);
  const cellByKey = new Map(rows.map((r) => [`${r[rowKey]}::${r[colKey]}`, Number(r[valueKey]) || 0]));

  return (
    <Card className="transition-shadow duration-[var(--duration-fast)] hover:shadow-md">
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-52 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (rows.length === 0 ? (
          <EmptyStateView message="No data yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: 4 }}>
              <thead>
                <tr>
                  <th />
                  {colValues.map((col) => (
                    <th key={col} className="px-1 text-xs font-medium text-text-muted">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowValues.map((row) => (
                  <tr key={row}>
                    <td className="whitespace-nowrap pr-2 text-right text-xs font-medium text-text-muted">{row}</td>
                    {colValues.map((col) => {
                      const value = cellByKey.get(`${row}::${col}`);
                      const intensity = max > 0 && value !== undefined ? Math.round((value / max) * 100) : 0;
                      return (
                        <td
                          key={col}
                          title={value !== undefined ? `${row} / ${col}: ${value}` : undefined}
                          className="h-9 w-9 rounded-md text-center text-xs text-text"
                          style={{ background: value !== undefined ? `color-mix(in srgb, var(--color-accent) ${intensity}%, transparent)` : "var(--color-surface-hover)" }}
                        >
                          {value ?? ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
