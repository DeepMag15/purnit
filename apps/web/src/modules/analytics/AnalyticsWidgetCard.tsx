"use client";

import { useState } from "react";
import { KpiCard } from "../../sdui/primitives/KpiCard";
import { Chart } from "../../sdui/primitives/Chart";
import { Treemap } from "../../sdui/primitives/Treemap";
import { Funnel } from "../../sdui/primitives/Funnel";
import { Heatmap } from "../../sdui/primitives/Heatmap";
import { TimelineChart } from "../../sdui/primitives/TimelineChart";
import { Leaderboard } from "../../sdui/primitives/Leaderboard";
import { ProgressGoal } from "../../sdui/primitives/ProgressGoal";
import { AnalyticsDrillDown } from "./AnalyticsDrillDown";
import { formatCents } from "../invoices/money";

interface ScalarWidget {
  kind: "scalar";
  key: string;
  module: string;
  label: string;
  format: "count" | "percent" | "duration" | "currency";
  unit?: string;
  value: number;
  trend?: number[];
  drillDown?: { source: string; params?: Record<string, unknown> };
}

interface BreakdownWidget {
  kind: "breakdown";
  key: string;
  module: string;
  label: string;
  nameKey: string;
  valueKey: string;
  rows: Record<string, unknown>[];
}

export type AnalyticsWidget = ScalarWidget | BreakdownWidget;

// A handful of widgets demonstrate drill-down interactivity in Phase A —
// keyed here on the frontend rather than a generic backend field, since only
// 2-3 need to prove the pattern (see the architecture plan's §5.4), not
// every breakdown metric.
const BREAKDOWN_DRILL_DOWN: Record<string, (segment: string) => { source: string; params?: Record<string, unknown> }> = {
  "projects.statusBreakdown": (status) => ({ source: "projects.list", params: { status } }),
};

// Phase C (Visual & Widget-Type Depth) — which primitive renders a given
// breakdown widget is purely a frontend dispatch choice (every new render
// kind still consumes the same {nameKey, valueKey, rows} shape the backend
// already returns), same precedent as the original chart-type map above.
// `projects.statusBreakdown` deliberately stays "donut" — it's the one
// widget with real click-to-drill-down wired (BREAKDOWN_DRILL_DOWN above),
// which the new non-Chart primitives (Treemap/Funnel/Heatmap/Timeline/
// Leaderboard) don't support yet; `tasks.byPriority` (no drill-down wired)
// is re-presented as `treemap` instead so Treemap gets a real demo without
// losing any already-shipped interactivity.
type BreakdownRenderKind = "donut" | "bar" | "stacked-bar" | "scatter" | "radial" | "treemap" | "funnel" | "heatmap" | "timeline" | "leaderboard";
const BREAKDOWN_RENDER_KIND: Record<string, BreakdownRenderKind> = {
  "projects.statusBreakdown": "donut",
  "tasks.byPriority": "treemap",
  "attendance.rateByDepartment": "bar",
  "tasks.byProjectStatus": "stacked-bar",
  "tasks.statusFunnel": "funnel",
  "tasks.completionLeaderboard": "leaderboard",
  "tasks.assigneeWorkload": "scatter",
  "attendance.statusByDepartment": "heatmap",
  "meetings.timeline": "timeline",
  // Analytics Phase D — permission-controlled widgets, reusing Phase C's
  // already-built Leaderboard primitive, zero new frontend component.
  "department.performanceLeaderboard": "leaderboard",
  "tasks.productivityLeaderboard": "leaderboard",
  // Analytics Phase F — Cross-Module Composites + Executive Attention. All
  // 3 reuse the same Leaderboard primitive, zero new frontend component.
  // (employeeProductivityScore, the phase's one composite metric, needs no
  // entry here at all — it arrives as an ordinary kind:"scalar" widget on
  // the wire and falls through to the default KpiCard rendering below.)
  "projects.atRisk": "leaderboard",
  "tasks.overloadedEmployees": "leaderboard",
  "documents.pendingApprovals": "leaderboard",
};
const CHART_NATIVE_KINDS = new Set<BreakdownRenderKind>(["donut", "bar", "stacked-bar", "scatter", "radial"]);
// Only tasks.byProjectStatus needs this — its stage columns can't be
// inferred generically from rows the way nameKey/valueKey can.
const STACKED_BAR_SERIES_KEYS: Record<string, string[]> = {
  "tasks.byProjectStatus": ["todo", "in_progress", "done"],
};

// tasks.completionRate is re-presented as a goal-tracking widget instead of
// a plain KpiCard — a real, small demonstration of ProgressGoal, not a new
// backend concept (the 80% target is a frontend-hardcoded demo value, same
// "Phase A shortcut" precedent BREAKDOWN_DRILL_DOWN above already set;
// formalizing a real per-metric target remains a disclosed future
// improvement).
const SCALAR_RENDER_KIND: Record<string, "kpi" | "progress"> = {
  "tasks.completionRate": "progress",
};
const PROGRESS_TARGETS: Record<string, number> = {
  "tasks.completionRate": 80,
};

function formatValue(widget: ScalarWidget): string {
  if (widget.format === "percent") return `${widget.value}${widget.unit ?? "%"}`;
  // Finance Domain, Phase C — value is cents, same convention every money
  // field in this app already uses; reuses the one shared cents<->dollars
  // formatter (money.ts) rather than a second implementation.
  if (widget.format === "currency") return formatCents(widget.value);
  if (widget.unit) return `${widget.value} ${widget.unit}`;
  return String(widget.value);
}

export function AnalyticsWidgetCard({ widget }: { widget: AnalyticsWidget }) {
  const [drillDown, setDrillDown] = useState<{ source: string; params?: Record<string, unknown> } | null>(null);
  const [showTrend, setShowTrend] = useState(false);

  if (widget.kind === "scalar") {
    const clickable = !!widget.drillDown || !!widget.trend;
    const renderKind = SCALAR_RENDER_KIND[widget.key] ?? "kpi";
    return (
      <div className="flex flex-col gap-2">
        <div
          className={clickable ? "cursor-pointer" : undefined}
          onClick={() => {
            if (widget.drillDown) setDrillDown(widget.drillDown);
            else if (widget.trend) setShowTrend((v) => !v);
          }}
        >
          {renderKind === "progress" ? (
            <ProgressGoal
              label={widget.label}
              target={PROGRESS_TARGETS[widget.key] ?? 100}
              format={widget.format === "percent" ? "percent" : "count"}
              bind={{ const: widget.value }}
              nodeId={`analytics-${widget.key}`}
              renderChild={() => null}
            />
          ) : (
            <KpiCard
              label={widget.label}
              bind={{ const: formatValue(widget) }}
              trend={widget.trend}
              trendTone="accent"
              nodeId={`analytics-${widget.key}`}
              renderChild={() => null}
            />
          )}
        </div>
        {drillDown && (
          <AnalyticsDrillDown mode="list" source={drillDown.source} params={drillDown.params} onClose={() => setDrillDown(null)} />
        )}
        {showTrend && widget.trend && <AnalyticsDrillDown mode="trend" metricKey={widget.key} onClose={() => setShowTrend(false)} />}
      </div>
    );
  }

  const onSegment = BREAKDOWN_DRILL_DOWN[widget.key];
  const renderKind = BREAKDOWN_RENDER_KIND[widget.key] ?? "donut";
  const nodeId = `analytics-${widget.key}`;
  const stubProps = { nodeId, renderChild: () => null } as const;

  let content;
  if (CHART_NATIVE_KINDS.has(renderKind)) {
    content = (
      <Chart
        title={widget.label}
        type={renderKind as "donut" | "bar" | "stacked-bar" | "scatter" | "radial"}
        nameKey={widget.nameKey}
        valueKey={widget.valueKey}
        seriesKeys={STACKED_BAR_SERIES_KEYS[widget.key]}
        bind={{ const: widget.rows }}
        onSegmentClick={onSegment ? (segment) => setDrillDown(onSegment(segment)) : undefined}
        {...stubProps}
      />
    );
  } else if (renderKind === "treemap") {
    content = <Treemap title={widget.label} nameKey={widget.nameKey} valueKey={widget.valueKey} bind={{ const: widget.rows }} {...stubProps} />;
  } else if (renderKind === "funnel") {
    content = <Funnel title={widget.label} nameKey={widget.nameKey} valueKey={widget.valueKey} bind={{ const: widget.rows }} {...stubProps} />;
  } else if (renderKind === "leaderboard") {
    content = <Leaderboard title={widget.label} nameKey={widget.nameKey} valueKey={widget.valueKey} limit={10} bind={{ const: widget.rows }} {...stubProps} />;
  } else if (renderKind === "timeline") {
    content = <TimelineChart title={widget.label} labelKey="label" startKey="start" endKey="end" bind={{ const: widget.rows }} {...stubProps} />;
  } else {
    // "heatmap" — the only kind needing distinct row/col keys beyond
    // nameKey/valueKey; every heatmap-rendered metric today
    // (attendance.statusByDepartment) uses "department"/"status" directly.
    content = <Heatmap title={widget.label} rowKey="department" colKey="status" valueKey="count" bind={{ const: widget.rows }} {...stubProps} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {content}
      {drillDown && <AnalyticsDrillDown mode="list" source={drillDown.source} params={drillDown.params} onClose={() => setDrillDown(null)} />}
    </div>
  );
}
