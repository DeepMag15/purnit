import { z } from "zod";
import { Treemap as RechartsTreemap, ResponsiveContainer, Tooltip } from "recharts";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";
import { CHART_SERIES_COLORS } from "./chart-colors";

export const TreemapSchema = z.object({
  title: z.string().optional(),
  nameKey: z.string().default("name"),
  valueKey: z.string().default("value"),
});
type Props = z.infer<typeof TreemapSchema>;

const COLORS = CHART_SERIES_COLORS;
const tooltipStyle = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

interface Row {
  [key: string]: unknown;
}

/** Single-level treemap over a flat row array — recharts' `Treemap` accepts
 * this shape directly, no nested `children` hierarchy needed. A separate
 * primitive from `Chart` rather than one more `type` on it: Treemap's data
 * shape (hierarchical) and `Chart`'s `nameKey`/`valueKey` convention (flat
 * category/magnitude pairs) don't cleanly unify. */
export function Treemap({ title, nameKey, valueKey, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const total = rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);

  return (
    <Card className="transition-shadow duration-[var(--duration-fast)] hover:shadow-md">
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-52 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (total === 0 ? (
          <EmptyStateView message="No data yet." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <RechartsTreemap data={rows} dataKey={valueKey} nameKey={nameKey} stroke="var(--color-border)" fill={COLORS[0]}>
              <Tooltip contentStyle={tooltipStyle} />
            </RechartsTreemap>
          </ResponsiveContainer>
        ))}
      </CardBody>
    </Card>
  );
}
