import { z } from "zod";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const ChartSchema = z.object({
  title: z.string().optional(),
  nameKey: z.string().default("status"),
  valueKey: z.string().default("count"),
});
type Props = z.infer<typeof ChartSchema>;

// CSS var() strings, not fixed hex — theme-reactive for free (light/dark)
// since SVG `fill` accepts custom properties in evergreen browsers, and it
// keeps the chart in step with the same token palette as everything else
// rather than a separate hardcoded chart palette.
const COLORS = ["var(--color-accent)", "var(--color-info)", "var(--color-success)", "var(--color-warning)", "var(--color-danger)"];

interface Row {
  [key: string]: unknown;
}

// A single donut chart, deliberately not a general-purpose charting
// primitive with a dozen chart-type options — this is the one dashboard
// visualization requested for this stage (see CONTEXT.md). Extend with a
// `type` prop (bar/line) if/when a page actually needs one.
export function Chart({ title, nameKey, valueKey, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);

  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-52 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (total === 0 ? (
          <EmptyStateView message="No data yet." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius={55} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                {rows.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        ))}
      </CardBody>
    </Card>
  );
}
