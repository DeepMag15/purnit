import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const LeaderboardSchema = z.object({
  title: z.string().optional(),
  nameKey: z.string().default("name"),
  valueKey: z.string().default("value"),
  limit: z.number().int().positive().default(10),
});
type Props = z.infer<typeof LeaderboardSchema>;

interface Row {
  [key: string]: unknown;
}

/** A ranked list — generic over whatever breakdown-shaped rows a metric
 * produces, sorted desc by `valueKey` client-side (the metric itself is
 * free to return rows in any order; ranking is this primitive's job). */
export function Leaderboard({ title, nameKey, valueKey, limit, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const ranked = [...rows].sort((a, b) => (Number(b[valueKey]) || 0) - (Number(a[valueKey]) || 0)).slice(0, limit);

  return (
    <Card className="transition-shadow duration-[var(--duration-fast)] hover:shadow-md">
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-1">
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load data: {error}</Alert>}
        {!loading && !error && (ranked.length === 0 ? (
          <EmptyStateView message="No data yet." />
        ) : (
          ranked.map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm">
              <div className="flex items-center gap-2 truncate">
                <span className="w-6 shrink-0 text-xs font-semibold text-text-muted">#{i + 1}</span>
                <span className="truncate text-text">{String(row[nameKey] ?? "")}</span>
              </div>
              <span className="shrink-0 font-mono text-text">{String(row[valueKey] ?? "")}</span>
            </div>
          ))
        ))}
      </CardBody>
    </Card>
  );
}
