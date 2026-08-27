"use client";

import { useState } from "react";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { Chart } from "../../sdui/primitives/Chart";
import { Table3 } from "../../sdui/primitives/Table";
import { CalendarHeatmap } from "../../sdui/primitives/CalendarHeatmap";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";

interface ListModeProps {
  mode: "list";
  source: string;
  params?: Record<string, unknown>;
  onClose: () => void;
}
interface TrendModeProps {
  mode: "trend";
  metricKey: string;
  onClose: () => void;
}

/** Composite-internal drill-down panel — plain local React state, the same
 * pattern AttendanceWorkspace/RolesPermissionsWorkspace already use.
 * Deliberately not built on openModal/openDrawer (confirmed inert no-ops in
 * use-action-dispatch.ts). "list" mode reuses an existing, already-scoped
 * list data source verbatim — zero new backend surface. "trend" mode calls
 * the new analytics.trend source for a deeper (90-day) range than the
 * dashboard's own default 30-day sparkline. */
export function AnalyticsDrillDown(props: ListModeProps | TrendModeProps) {
  if (props.mode === "trend") return <TrendPanel metricKey={props.metricKey} onClose={props.onClose} />;
  return <ListPanel source={props.source} params={props.params} onClose={props.onClose} />;
}

function TrendPanel({ metricKey, onClose }: { metricKey: string; onClose: () => void }) {
  const [view, setView] = useState<"line" | "calendar">("line");
  const { data, isPending, error } = useDataSourceQuery<{ periodStart: string; value: number }[]>("analytics.trend", { metricKey, days: 90 });
  const lineRows = (data ?? []).map((r) => ({ date: new Date(r.periodStart).toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: r.value }));
  const calendarRows = (data ?? []).map((r) => ({ date: r.periodStart, value: r.value }));

  const toggle = (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-border">
        <button
          type="button"
          className={"px-2 py-1 text-xs" + (view === "line" ? " bg-accent text-accent-fg" : " text-text-muted hover:text-text")}
          onClick={() => setView("line")}
        >
          Line
        </button>
        <button
          type="button"
          className={"px-2 py-1 text-xs" + (view === "calendar" ? " bg-accent text-accent-fg" : " text-text-muted hover:text-text")}
          onClick={() => setView("calendar")}
        >
          Calendar
        </button>
      </div>
      <Button size="sm" variant="secondary" onClick={onClose}>
        Close
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader title="90-day trend" action={toggle} />
      <CardBody>
        {isPending && <Skeleton className="h-40 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load trend: {error instanceof Error ? error.message : String(error)}</Alert>}
        {!isPending &&
          !error &&
          (view === "line" ? (
            <Chart type="line" nameKey="date" valueKey="value" bind={{ const: lineRows }} nodeId={`analytics-trend-${metricKey}`} renderChild={() => null} />
          ) : (
            <CalendarHeatmap dateKey="date" valueKey="value" bind={{ const: calendarRows }} nodeId={`analytics-trend-cal-${metricKey}`} renderChild={() => null} />
          ))}
      </CardBody>
    </Card>
  );
}

function ListPanel({ source, params, onClose }: { source: string; params?: Record<string, unknown>; onClose: () => void }) {
  const { data, isPending, error } = useDataSourceQuery<Record<string, unknown>[]>(source, params ?? {});
  const rows = data ?? [];
  // Drill-down targets return heterogeneous shapes across sources
  // (projects.list/tasks.list/...) with no per-source column config to draw
  // from — a reasonable cap keeps the panel readable rather than dumping
  // every internal field.
  const columns = rows.length > 0 ? Object.keys(rows[0]!).filter((k) => k !== "id").slice(0, 6) : [];

  return (
    <Card>
      <CardHeader title={`${rows.length} result${rows.length === 1 ? "" : "s"}`} action={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>} />
      <CardBody className="flex flex-col gap-1.5">
        {isPending && <Skeleton className="h-24 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load details: {error instanceof Error ? error.message : String(error)}</Alert>}
        {!isPending && !error && rows.length === 0 && <div className="text-sm text-text-muted">Nothing here.</div>}
        {!isPending && !error && rows.length > 0 && (
          <Table3
            columns={columns}
            sortable
            filterable
            pageSize={20}
            bind={{ const: rows }}
            nodeId="analytics-drilldown-list"
            renderChild={() => null}
          />
        )}
      </CardBody>
    </Card>
  );
}
