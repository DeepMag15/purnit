import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { cn } from "../../ui/utils";

export const KpiCardSchema = z.object({
  label: z.string(),
  // Optional trend line (e.g. [12, 18, 15, 22, 30]) — still a plain prop,
  // not a data binding of its own: AnalyticsWidgetCard (Core Workspace
  // Modules, Phase 4) is the real producer, passing real daily values read
  // from AnalyticsSnapshot history for metrics that opt into it. Any other
  // caller should still omit this rather than fabricate numbers to fill the
  // visual slot.
  trend: z.array(z.number()).optional(),
  trendTone: z.enum(["success", "danger", "accent"]).optional(),
  // Visual Polish & Consistency Pass — optional left-border accent so a KPI
  // can visually communicate meaning (e.g. "Overdue Tasks" reads as
  // attention-worthy). Reuses Badge's own 6-tone vocabulary/CSS variables;
  // omitted renders byte-for-byte identical to before this prop existed.
  tone: z.enum(["neutral", "success", "warning", "danger", "info", "accent"]).optional(),
});
type Props = z.infer<typeof KpiCardSchema>;

const TONE_BORDER_CLASSES: Record<NonNullable<Props["tone"]>, string> = {
  neutral: "border-l-2 border-l-border",
  success: "border-l-2 border-l-success",
  warning: "border-l-2 border-l-warning",
  danger: "border-l-2 border-l-danger",
  info: "border-l-2 border-l-info",
  accent: "border-l-2 border-l-accent",
};

/** Plain inline SVG, not Recharts — a 64×24px trend line doesn't warrant
 * pulling in a charting library (see Chart.tsx for the one case that does).
 * Colors follow the same `var(--color-*)` pattern Chart.tsx already
 * established, so the line stays theme-reactive for free. */
function Sparkline({ values, tone }: { values: number[]; tone: "success" | "danger" | "accent" }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 30 - ((v - min) / range) * 26;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 32" className="h-6 w-16 shrink-0" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={`var(--color-${tone})`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiCard({ label, bind, trend, trendTone, tone }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const showTrend = !loading && !error && trend && trend.length > 1;

  return (
    // Frontend Structural Redesign, Phase 0 — the shared hover-elevation
    // convention (§2.7): reuses the existing --shadow-*/--duration-* tokens,
    // no new values.
    <Card className={cn("p-4 transition-shadow duration-[var(--duration-fast)] hover:shadow-md", tone && TONE_BORDER_CLASSES[tone])}>
      <div className="text-xs font-medium text-text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <div className="font-mono text-2xl font-semibold tracking-tight text-text">
          {loading ? <Skeleton className="h-7 w-16" /> : error ? <span className="text-sm text-danger">—</span> : String(data ?? "—")}
        </div>
        {showTrend && <Sparkline values={trend} tone={trendTone ?? "accent"} />}
      </div>
    </Card>
  );
}
