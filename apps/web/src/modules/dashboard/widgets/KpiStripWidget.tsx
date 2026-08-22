"use client";

import { useDataSourceQuery } from "../../../sdui/use-data-binding";
import { useRenderContext } from "../../../sdui/render-context";
import { Skeleton } from "../../../ui/Skeleton";

interface Task {
  id: string;
  status: string;
}

function KpiCell({ label, value, tone, loading }: { label: string; value: number; tone?: "danger"; loading: boolean }) {
  return (
    <div className="flex-1 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-10" />
      ) : (
        <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === "danger" && value > 0 ? "text-danger" : "text-text"}`}>{value}</div>
      )}
    </div>
  );
}

/**
 * Frontend Redesign, Phase 01 — deliberately just two real, easy-to-verify
 * numbers derived from `tasks.list` (shared query cache with MyWorkWidget/
 * AiInsightsWidget) rather than a new metrics pipeline. A richer KPI set
 * belongs in Analytics, which already has one (MetricRegistry) — this strip
 * is a glance, not a report.
 */
export function KpiStripWidget() {
  const { user } = useRenderContext();
  const { data: mine, isPending: p1 } = useDataSourceQuery<Task[]>("tasks.list", { assigneeId: user.id });
  const { data: overdue, isPending: p2 } = useDataSourceQuery<Task[]>("tasks.list", { assigneeId: user.id, overdue: true });

  const openCount = (Array.isArray(mine) ? mine : []).filter((t) => t.status !== "done").length;
  const overdueCount = Array.isArray(overdue) ? overdue.length : 0;

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <KpiCell label="Open tasks" value={openCount} loading={p1} />
      <KpiCell label="Overdue" value={overdueCount} tone="danger" loading={p2} />
    </div>
  );
}
