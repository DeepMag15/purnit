import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";

export const ProgressGoalSchema = z.object({
  label: z.string(),
  target: z.number(),
  format: z.enum(["count", "percent"]).default("count"),
});
type Props = z.infer<typeof ProgressGoalSchema>;

/** A labeled bar showing a bound scalar value against a fixed `target` —
 * `KpiCard`-adjacent (same `Card` wrapper/value-formatting conventions) but
 * a distinct primitive, since a goal has a target `KpiCard` has no concept
 * of. */
export function ProgressGoal({ label, target, format, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const value = typeof data === "number" ? data : Number(data) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const suffix = format === "percent" ? "%" : "";

  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : error ? (
          <span className="text-sm text-danger">—</span>
        ) : (
          <div className="font-mono text-lg font-semibold text-text">
            {value}
            {suffix} <span className="text-xs font-normal text-text-muted">/ {target}{suffix}</span>
          </div>
        )}
      </div>
      {!loading && !error && (
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
          <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </Card>
  );
}
