"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { GridLayout, useContainerWidth, type Layout } from "react-grid-layout";
import type { UINode } from "@antigravity/manifest-schema";
import type { CommonRenderProps } from "../registry";
import { useDataSourceQuery } from "../use-data-binding";
import { useRenderContext } from "../render-context";
import { useToast } from "../../ui/Toast";
import { Skeleton } from "../../ui/Skeleton";
import { Card, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";

export const DashboardGridSchema = z.object({ dashboardKey: z.string() });
type Props = z.infer<typeof DashboardGridSchema>;

export interface WidgetLayoutEntry {
  key: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Same fork Analytics' own dashboard-customization phase already made —
// drag/resize is a desktop/mouse interaction, not built for touch.
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

// Same simple flowing 12-column grid AnalyticsDashboard.tsx's own
// autoLayout already uses — deliberately duplicated, not shared, per this
// phase's own disclosed scope boundary (no refactor of already-shipped
// Analytics code).
export function autoLayout(keys: string[]): WidgetLayoutEntry[] {
  return keys.map((key, i) => ({ key, visible: true, x: (i % 2) * 6, y: Math.floor(i / 2) * 4, w: 6, h: 4 }));
}

// A widget (child node) present in `childKeys` but absent from `saved` (a
// blueprint change adding a new widget after this layout was last saved)
// auto-appends below the lowest existing item, never dropped. A saved entry
// for a widget no longer present in the blueprint is skipped. Same shape as
// AnalyticsDashboard.tsx's own mergeLayout, deliberately reimplemented not
// shared — see this phase's own plan for why.
export function mergeLayout(childKeys: string[], saved: WidgetLayoutEntry[] | undefined): WidgetLayoutEntry[] {
  if (!saved || saved.length === 0) return autoLayout(childKeys);

  const keySet = new Set(childKeys);
  const merged: WidgetLayoutEntry[] = [];
  let nextY = 0;
  for (const entry of saved) {
    if (!keySet.has(entry.key)) continue;
    merged.push(entry);
    nextY = Math.max(nextY, entry.y + entry.h);
  }
  const seen = new Set(merged.map((e) => e.key));
  for (const key of childKeys) {
    if (seen.has(key)) continue;
    merged.push({ key, visible: true, x: 0, y: nextY, w: 6, h: 4 });
    nextY += 4;
  }
  return merged;
}

/**
 * Platform UI/UX Redesign, Phase F — a customizable drag/resize/save/reset
 * grid for a *static*, blueprint-authored set of already-independently-
 * bound child widgets (each child is an ordinary SDUI node with its own
 * `bind`, e.g. a KpiCard bound to `projects.count`) — unlike
 * AnalyticsDashboard, this primitive never computes a widget catalog
 * server-side; the catalog is simply `childNodes` itself. Reuses the exact
 * same `DashboardLayout` persistence/versioning mechanism Analytics already
 * proved (`dashboardLayout.save`/`.reset`, now `dashboardKey`-aware) and the
 * same conceptual react-grid-layout pattern — a fresh, parallel frontend
 * implementation, not shared code with AnalyticsDashboard.tsx, a deliberate
 * choice to avoid any risk to that already-shipped component.
 */
export function DashboardGrid({ dashboardKey, childNodes, renderChild }: Props & CommonRenderProps) {
  const { callMutation } = useRenderContext();
  const { show: showToast } = useToast();
  const isDesktop = useIsDesktop();
  const { width, containerRef, mounted } = useContainerWidth();

  const children: UINode[] = useMemo(() => childNodes ?? [], [childNodes]);
  const childById = new Map(children.map((c) => [c.id, c]));
  const childLabel = (c: UINode) => (typeof c.props?.title === "string" ? c.props.title : typeof c.props?.label === "string" ? c.props.label : c.id);

  const { data, isPending, error, refetch } = useDataSourceQuery<{ layout?: WidgetLayoutEntry[] }>("dashboardLayout.get", { dashboardKey });

  const childKeys = useMemo(() => children.map((c) => c.id), [children]);
  const serverLayout = useMemo(() => mergeLayout(childKeys, data?.layout), [childKeys, data?.layout]);

  const [editMode, setEditMode] = useState(false);
  const [localLayout, setLocalLayout] = useState<WidgetLayoutEntry[] | null>(null);
  const [managingWidgets, setManagingWidgets] = useState(false);
  const [saving, setSaving] = useState(false);

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
      await callMutation("dashboardLayout.save", { widgets: layout, dashboardKey });
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
      await callMutation("dashboardLayout.reset", { dashboardKey });
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

  const visibleEntries = layout.filter((e) => e.visible && childById.has(e.key));
  const rglLayout: Layout = visibleEntries.map((e) => ({ i: e.key, x: e.x, y: e.y, w: e.w, h: e.h }));

  return (
    <div className="flex flex-col gap-4">
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
              const child = childById.get(e.key);
              if (!child) return null;
              return (
                <label key={e.key} className="flex items-center gap-2 text-sm text-text">
                  <input type="checkbox" checked={e.visible} onChange={() => toggleWidgetVisible(e.key)} />
                  {childLabel(child)}
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

      {!isPending &&
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
                {visibleEntries.map((e) => <div key={e.key}>{renderChild(childById.get(e.key)!)}</div>)}
              </GridLayout>
            )}
          </div>
        ) : (
          // Below MOBILE_BREAKPOINT — a plain, read-only stacked list in
          // saved order, respecting saved visibility, no drag/resize at all.
          <div className="flex flex-col gap-4">{visibleEntries.map((e) => <div key={e.key}>{renderChild(childById.get(e.key)!)}</div>)}</div>
        ))}
    </div>
  );
}
