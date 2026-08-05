"use client";

import { z } from "zod";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { AnalyticsWidgetCard, type AnalyticsWidget } from "./AnalyticsWidgetCard";
import { AnalyticsFilterProvider, useAnalyticsFilters } from "./analytics-filter-state";
import { AnalyticsFilterBar } from "./AnalyticsFilterBar";
import { AnalyticsViewTabs } from "./AnalyticsViewTabs";

export const AnalyticsDashboardSchema = z.object({});
type Props = z.infer<typeof AnalyticsDashboardSchema>;

/**
 * Core Workspace Modules, Phase 4: Analytics & Insights — a zero-prop
 * composite, mirrors AttendanceWorkspace's/RolesPermissionsWorkspace's "pull
 * my own data via useDataSourceQuery" shape rather than a static tree of
 * individually-bound KpiCard/Chart blueprint nodes. Outer component just
 * mounts the Analytics-scoped filter provider (Phase B) — split out so the
 * inner content can read filter state via context.
 */
export function AnalyticsDashboard(_props: Props & CommonRenderProps) {
  return (
    <AnalyticsFilterProvider>
      <AnalyticsDashboardContent />
    </AnalyticsFilterProvider>
  );
}

function AnalyticsDashboardContent() {
  const filters = useAnalyticsFilters();
  const { data, isPending, error } = useDataSourceQuery<{ widgets: AnalyticsWidget[] }>("analytics.dashboard", {
    from: filters.from,
    to: filters.to,
    departmentId: filters.departmentId,
    teamId: filters.teamId,
    projectId: filters.projectId,
    employeeId: filters.employeeId,
  });

  // The filter bar stays visible during loading/error so a viewer can adjust
  // filters without losing their place, rather than the whole page bouncing
  // between a bare skeleton and the real content on every filter change.
  const widgets = data?.widgets ?? [];
  const byModule = new Map<string, AnalyticsWidget[]>();
  for (const widget of widgets) {
    const list = byModule.get(widget.module) ?? [];
    list.push(widget);
    byModule.set(widget.module, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <AnalyticsViewTabs />
      <AnalyticsFilterBar />

      {isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}
      {!isPending && error && (
        <Alert tone="danger">Couldn&apos;t load analytics: {error instanceof Error ? error.message : String(error)}</Alert>
      )}
      {!isPending && !error && widgets.length === 0 && <EmptyStateView message="No analytics available for your role yet." />}
      {!isPending &&
        !error &&
        [...byModule.entries()].map(([module, moduleWidgets]) => (
          <div key={module} className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{module}</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {moduleWidgets.map((widget) => (
                <AnalyticsWidgetCard key={widget.key} widget={widget} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
