"use client";

import { useEffect, useMemo, useState } from "react";
import { GridLayout, useContainerWidth, type Layout } from "react-grid-layout";
import { useBootstrap } from "../../app/workspace/bootstrap-context";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery } from "../../sdui/use-data-binding";
import { useToast } from "../../ui/Toast";
import { Button } from "../../ui/Button";
import { Card, CardBody } from "../../ui/Card";
import { eligibleWidgets, type DashboardWidgetDef } from "./widget-catalog";

const DASHBOARD_KEY = "home";

interface WidgetLayoutEntry {
  key: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Drag/resize is a desktop/mouse interaction — same fork AnalyticsDashboard/
// DashboardGrid already each independently made (their own doc comments
// explain why this is deliberately duplicated three times now rather than
// shared: three small, low-risk composites, not worth a shared abstraction
// for one media query + one constant).
const MOBILE_BREAKPOINT = 768;

function useIsDesktop(): boolean {
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

// Home's own span→size mapping — narrower than Analytics' fixed 6×4 for
// everything, since `DashboardWidgetDef.span` already carries real intent
// (narrow/wide/full) `AnalyticsWidget` has no equivalent of. `kpiStrip` is
// the one "full" widget that's a thin strip, not a full card — h:2, not the
// h:4 every other widget gets.
function spanSize(widget: DashboardWidgetDef): { w: number; h: number } {
  if (widget.span === "narrow") return { w: 4, h: 4 };
  if (widget.span === "wide") return { w: 8, h: 4 };
  return { w: 12, h: widget.key === "kpiStrip" ? 2 : 4 };
}

// A simple flowing 12-column grid — packs widgets left-to-right in catalog
// order, wrapping to a new row whenever one wouldn't fit, same "simple
// flowing grid" spirit as AnalyticsDashboard's own `autoLayout`. Every entry
// starts visible — unlike Analytics' DEFAULT_VISIBLE_WIDGET_COUNT trim
// (needed there because its metric catalog can run to dozens of widgets),
// Home's catalog is a small, already-curated 6 items; hiding some by default
// would just regress what every existing user already sees today.
function autoLayout(widgets: DashboardWidgetDef[]): WidgetLayoutEntry[] {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  const entries: WidgetLayoutEntry[] = [];
  for (const widget of widgets) {
    const { w, h } = spanSize(widget);
    if (x + w > 12) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    entries.push({ key: widget.key, visible: true, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return entries;
}

// Same reasoning as AnalyticsDashboard's own mergeLayout: a widget key
// present in the catalog but absent from a saved layout (shipped after that
// layout was last saved, or a permission just granted surfacing it for the
// first time) is auto-appended below the lowest existing item, never
// dropped; a saved entry for a widget no longer eligible is simply skipped.
function mergeLayout(widgets: DashboardWidgetDef[], saved: WidgetLayoutEntry[] | undefined): WidgetLayoutEntry[] {
  if (!saved || saved.length === 0) return autoLayout(widgets);

  const widgetByKey = new Map(widgets.map((w) => [w.key, w]));
  const merged: WidgetLayoutEntry[] = [];
  let nextY = 0;
  for (const entry of saved) {
    if (!widgetByKey.has(entry.key)) continue;
    merged.push(entry);
    nextY = Math.max(nextY, entry.y + entry.h);
  }
  const seen = new Set(merged.map((e) => e.key));
  for (const widget of widgets) {
    if (seen.has(widget.key)) continue;
    const { w, h } = spanSize(widget);
    merged.push({ key: widget.key, visible: true, x: 0, y: nextY, w, h });
    nextY += h;
  }
  return merged;
}

/**
 * Frontend Redesign, Phase 01 replaced the generic JSON-page renderer on
 * `/workspace` with this purpose-built, role-shaped dashboard. Dashboard
 * Customization (module 5 of 6) closes the gap that first pass explicitly
 * disclosed (`widget-catalog.ts`'s own old doc comment): saved per-user
 * hide/reorder/resize, via the exact same generic `dashboardLayout.get/save/
 * reset` mutations Analytics already uses (`dashboardKey: "home"`, its own
 * distinct key — `page.dashboard`'s never-rendered `DashboardGrid` blueprint
 * node already sits on `dashboardKey: "dashboard"`, a separate, unrelated,
 * dead code path since Phase 01 replaced this route; reusing that key would
 * have been a coincidental, confusing collision, not a reuse).
 *
 * A third small `autoLayout`/`mergeLayout` implementation, not shared with
 * Analytics' or DashboardGrid's own — the same deliberate "avoid risk to
 * already-shipped components" choice `DashboardGrid`'s own doc comment
 * already made relative to Analytics. Widget *eligibility* stays exactly
 * `widget-catalog.ts`'s existing manifest-derived logic — this only adds
 * position/visibility on top of it, never a second eligibility mechanism.
 */
export function HomeDashboard() {
  const { manifest } = useBootstrap();
  const { callMutation } = useRenderContext();
  const { show: showToast } = useToast();
  const isDesktop = useIsDesktop();
  const { width, containerRef, mounted } = useContainerWidth();

  const firstName = manifest.user.displayName.split(" ")[0];
  const widgets = useMemo(() => eligibleWidgets(manifest), [manifest]);
  const widgetByKey = useMemo(() => new Map(widgets.map((w) => [w.key, w])), [widgets]);

  const { data, isPending, refetch } = useDataSourceQuery<{ layout?: WidgetLayoutEntry[] }>("dashboardLayout.get", { dashboardKey: DASHBOARD_KEY });
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
      await callMutation("dashboardLayout.save", { widgets: layout, dashboardKey: DASHBOARD_KEY });
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
      await callMutation("dashboardLayout.reset", { dashboardKey: DASHBOARD_KEY });
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            {greeting()}, {firstName}.
          </h1>
          <p className="mt-1 text-sm text-text-muted">Here&apos;s what&apos;s happening at {manifest.tenant.name}.</p>
        </div>

        {isDesktop && (
          <div className="flex items-center gap-2">
            {!editMode ? (
              <Button size="sm" variant="secondary" onClick={startEditing} disabled={isPending}>
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
      </div>

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

      {isDesktop ? (
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
              {visibleEntries.map((e) => {
                const widget = widgetByKey.get(e.key)!;
                return (
                  <div key={e.key}>
                    <widget.component />
                  </div>
                );
              })}
            </GridLayout>
          )}
        </div>
      ) : (
        // Below MOBILE_BREAKPOINT — a plain, read-only stacked list in saved
        // order, respecting saved visibility, no drag/resize at all.
        <div className="flex flex-col gap-4">
          {visibleEntries.map((e) => {
            const widget = widgetByKey.get(e.key)!;
            return <widget.component key={e.key} />;
          })}
        </div>
      )}
    </div>
  );
}
