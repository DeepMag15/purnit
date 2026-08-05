import { z } from "zod";
import { FunnelChart, Funnel as RechartsFunnel, Cell, LabelList, Tooltip, ResponsiveContainer } from "recharts";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const FunnelSchema = z.object({
  title: z.string().optional(),
  nameKey: z.string().default("name"),
  valueKey: z.string().default("value"),
});
type Props = z.infer<typeof FunnelSchema>;

const COLORS = ["var(--color-accent)", "var(--color-info)", "var(--color-success)", "var(--color-warning)", "var(--color-danger)"];
const tooltipStyle = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

interface Row {
  [key: string]: unknown;
}

/** A separate primitive from `Chart` — a funnel's rows are staged, ordered
 * data (the metric itself decides stage order, e.g. `tasks.statusFunnel`),
 * not an arbitrary category breakdown. */
export function Funnel({ title, nameKey, valueKey, bind }: Props & CommonRenderProps) {
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
            <FunnelChart>
              <Tooltip contentStyle={tooltipStyle} />
              <RechartsFunnel data={rows} dataKey={valueKey} nameKey={nameKey}>
                <LabelList dataKey={nameKey} position="right" fill="var(--color-text-muted)" stroke="none" fontSize={12} />
                {rows.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </RechartsFunnel>
            </FunnelChart>
          </ResponsiveContainer>
        ))}
      </CardBody>
    </Card>
  );
}
