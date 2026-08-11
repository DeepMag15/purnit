"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { GridLayout, useContainerWidth, type Layout } from "react-grid-layout";
import type { CommonRenderProps } from "../../sdui/registry";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useRenderContext } from "../../sdui/render-context";
import { useToast } from "../../ui/Toast";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Card, CardBody } from "../../ui/Card";
import { AnalyticsWidgetCard, type AnalyticsWidget } from "./AnalyticsWidgetCard";
import { AnalyticsFilterProvider, useAnalyticsFilters } from "./analytics-filter-state";
import { AnalyticsFilterBar } from "./AnalyticsFilterBar";
import { AnalyticsViewTabs } from "./AnalyticsViewTabs";
import { formatCents } from "../invoices/money";

export const AnalyticsDashboardSchema = z.object({});
type Props = z.infer<typeof AnalyticsDashboardSchema>;

interface WidgetLayoutEntry {
  key: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Drag/resize is a desktop/mouse interaction, not built for touch — below
// this width the same widgets render as a plain read-only stacked list
// instead (Phase E's own confirmed fork), no react-grid-layout involved at
// all.
const MOBILE_BREAKPOINT = 768;

function useIsDesktop(): boolean {
  // Defaults true (server/first-paint) — a brief wrong-branch flash on a
  // genuinely narrow device is preferable to a broken grid measured against
  // a zero-width container; the whole composite already shows a loading
  // skeleton on first paint regardless (data hasn't arrived yet either).
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`);
    setIsDesktop(mql.matches);
    const listener = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, []);
  return isDesktop;
}

// A simple flowing 12-column grid — 2 widgets per row, w:6 h:4 each. The
// same small algorithm AuthService.signup independently implements
// server-side for a role's initial default template — deliberately
// duplicated cheaply on both sides of the runtime boundary rather than
// shared for one small function.
function autoLayout(keys: string[]): WidgetLayoutEntry[] {
  return keys.map((key, i) => ({ key, visible: true, x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 }));
}

// Analytics Phase H (AI Insights, first slice) — builds the exact text
// auto-sent to the AI Assistant when "Ask AI about this dashboard" is
// clicked, entirely client-side from whatever `analytics.dashboard` already
// returned (already permission-pruned, no server-side re-fetch needed — see
// the Phase H plan's own resolved fork for why this isn't a new backend
// mutation/data source). Capped at the first 5 rows per breakdown widget,
// same "keep the prompt readable" reasoning as `AnalyticsDrillDown`'s own
// column cap.
function formatWidgetsForAi(widgets: AnalyticsWidget[]): string {
  const lines = widgets.map((w) => {
    if (w.kind === "scalar") {
      // Finance Domain, Phase C — "currency" values are cents; formatted the
      // same way every other dollar amount in the app is, not left raw, so
      // the AI prompt doesn't see a misleading bare number like "105000".
      const value =
        w.format === "percent"
          ? `${w.value}${w.unit ?? "%"}`
          : w.format === "currency"
            ? formatCents(w.value)
            : w.unit
              ? `${w.value} ${w.unit}`
              : String(w.value);
      return `- ${w.label}: ${value}`;
    }
    const top = w.rows
      .slice(0, 5)
      .map((r) => `${r[w.nameKey]} (${r[w.valueKey]})`)
      .join(", ");
    return `- ${w.label}: ${top || "no data"}`;
  });
  return `Here's my current Analytics dashboard. Summarize what stands out, flag anything that looks concerning, and suggest 1-2 next actions.\n\n${lines.join("\n")}`;
}

// Merges the server's saved layout (if any) with whichever widgets
// analytics.dashboard actually returned this call — a widget key present in
// `widgets` but absent from `saved` (a metric shipped after this layout was
// last saved, or a permission just granted surfacing a widget for the first
// time) is auto-appended below the lowest existing item, never dropped. A
// saved entry for a widget no longer present (permission revoked, filter
// narrowed it away) is simply skipped.
function mergeLayout(widgets: AnalyticsWidget[], saved: WidgetLayoutEntry[] | undefined): WidgetLayoutEntry[] {
  if (!saved || saved.length === 0) return autoLayout(widgets.map((w) => w.key));

  const widgetKeys = new Set(widgets.map((w) => w.key));
  const merged: WidgetLayoutEntry[] = [];
  let nextY = 0;
  for (const entry of saved) {
    if (!widgetKeys.has(entry.key)) continue;
    merged.push(entry);
    nextY = Math.max(nextY, entry.y + entry.h);
  }
  const seen = new Set(merged.map((e) => e.key));
  for (const widget of widgets) {
    if (seen.has(widget.key)) continue;
    merged.push({ key: widget.key, visible: true, x: 0, y: nextY, w: 6, h: 4 });
    nextY += 4;
  }
  return merged;
}

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
  const { callMutation, openAiPanel, aiAvailable } = useRenderContext();
  const { show: showToast } = useToast();
  const isDesktop = useIsDesktop();
  const { width, containerRef, mounted } = useContainerWidth();

  const { data, isPending, error, refetch } = useDataSourceQuery<{ widgets: AnalyticsWidget[]; layout?: WidgetLayoutEntry[] }>("analytics.dashboard", {
    from: filters.from,
    to: filters.to,
    departmentId: filters.departmentId,
    teamId: filters.teamId,
    projectId: filters.projectId,
    employeeId: filters.employeeId,
  });

  const widgets = data?.widgets ?? [];
  const widgetByKey = new Map(widgets.map((w) => [w.key, w]));
  const serverLayout = useMemo(() => mergeLayout(widgets, data?.layout), [widgets, data?.layout]);

  const [editMode, setEditMode] = useState(false);
  const [localLayout, setLocalLayout] = useState<WidgetLayoutEntry[] | null>(null);
  const [managingWidgets, setManagingWidgets] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editing always starts from what the server just returned — local state
  // is discarded (not merged) on every fresh load, never stale.
  const layout = localLayout ?? serverLayout;

  function startEditing() {
    setLocalLayout(serverLayout);
    setEditMode(true);
  }
  function cancelEditing() {
    setLocalLayout(null);
    setEditMode(false);
    setManagingWidgets(false);
  }
  async function saveLayout() {
    setSaving(true);
    try {
      await callMutation("dashboardLayout.save", { widgets: layout });
      showToast("Dashboard layout saved");
      setLocalLayout(null);
      setEditMode(false);
      setManagingWidgets(false);
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't save layout", "danger");
    } finally {
      setSaving(false);
    }
  }
  async function resetLayout() {
    setSaving(true);
    try {
      await callMutation("dashboardLayout.reset", {});
      showToast("Dashboard reset to default");
      setLocalLayout(null);
      setEditMode(false);
      setManagingWidgets(false);
      refetch();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't reset layout", "danger");
    } finally {
      setSaving(false);
    }
  }
  function toggleWidgetVisible(key: string) {
    setLocalLayout((current) => (current ?? serverLayout).map((e) => (e.key === key ? { ...e, visible: !e.visible } : e)));
  }
  function handleLayoutChange(next: Layout) {
    if (!editMode) return;
    const byKey = new Map(next.map((item) => [item.i, item]));
    setLocalLayout((current) =>
      (current ?? serverLayout).map((e) => {
        const updated = byKey.get(e.key);
        return updated ? { ...e, x: updated.x, y: updated.y, w: updated.w, h: updated.h } : e;
      }),
    );
  }

  const visibleEntries = layout.filter((e) => e.visible && widgetByKey.has(e.key));
  const rglLayout: Layout = visibleEntries.map((e) => ({ i: e.key, x: e.x, y: e.y, w: e.w, h: e.h }));

  return (
    <div className="flex flex-col gap-6">
      <AnalyticsViewTabs />
      <AnalyticsFilterBar />

      {aiAvailable && widgets.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => openAiPanel("analytics.insights", formatWidgetsForAi(widgets))}>
            Ask AI about this dashboard
          </Button>
        </div>
      )}

      {isDesktop && (
        <div className="flex items-center justify-end gap-2">
          {!editMode ? (
            <Button size="sm" variant="secondary" onClick={startEditing} disabled={isPending || !!error}>
              Edit Layout
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setManagingWidgets((v) => !v)}>
                Manage Widgets
              </Button>
              <Button size="sm" variant="secondary" onClick={resetLayout} disabled={saving}>
                Reset to Default
              </Button>
              <Button size="sm" variant="secondary" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveLayout} disabled={saving}>
                Save
              </Button>
            </>
          )}
        </div>
      )}

      {isDesktop && editMode && managingWidgets && (
        <Card>
          <CardBody className="flex flex-col gap-1.5">
            {layout.map((e) => {
              const widget = widgetByKey.get(e.key);
              if (!widget) return null;
              return (
                <label key={e.key} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={e.visible} onChange={() => toggleWidgetVisible(e.key)} />
                  {widget.label}
                </label>
              );
            })}
          </CardBody>
        </Card>
      )}

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
        widgets.length > 0 &&
        (isDesktop ? (
          <div ref={containerRef}>
            {mounted && (
              <GridLayout
                width={width}
                layout={rglLayout}
                gridConfig={{ cols: 12, rowHeight: 80, margin: [16, 16], containerPadding: [0, 0], maxRows: Infinity }}
                dragConfig={{ enabled: editMode }}
                resizeConfig={{ enabled: editMode }}
                onLayoutChange={handleLayoutChange}
              >
                {visibleEntries.map((e) => (
                  <div key={e.key}>
                    <AnalyticsWidgetCard widget={widgetByKey.get(e.key)!} />
                  </div>
                ))}
              </GridLayout>
            )}
          </div>
        ) : (
          // Below MOBILE_BREAKPOINT — a plain, read-only stacked list in
          // saved order, respecting saved visibility, no drag/resize at all.
          <div className="flex flex-col gap-4">
            {visibleEntries.map((e) => (
              <AnalyticsWidgetCard key={e.key} widget={widgetByKey.get(e.key)!} />
            ))}
          </div>
        ))}
    </div>
  );
}
