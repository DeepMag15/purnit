"use client";

import { useState } from "react";
import { useRenderContext } from "../../sdui/render-context";
import { useAnalyticsFilters } from "./analytics-filter-state";
import { cn } from "../../ui/utils";

type ViewPreset = "company" | "department" | "team" | "personal";

const VIEWS: { key: ViewPreset; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "department", label: "Department" },
  { key: "team", label: "Team" },
  { key: "personal", label: "Personal" },
];

/**
 * Four named starting filter states layered on top of AnalyticsFilterBar's
 * own filter state (Part 8 of the BI architecture) — not four separate
 * dashboards. All four are shown unconditionally to every viewer: a filter
 * can only ever narrow what a viewer's real permissions already grant
 * (enforced server-side, per-metric), never widen it, so there's no safety
 * reason to hide a tab from a lower tier — "Company Overview" for a
 * Practitioner just renders the same own/team-scoped data they'd already
 * see anywhere else in the app.
 */
export function AnalyticsViewTabs() {
  const { user } = useRenderContext();
  const filters = useAnalyticsFilters();
  const [active, setActive] = useState<ViewPreset>("company");

  function select(view: ViewPreset) {
    setActive(view);
    if (view === "company") {
      filters.clearEntityFilters();
    } else if (view === "personal") {
      filters.clearEntityFilters();
      filters.setFilter("employeeId", user.id);
    }
    // "department"/"team": no auto-selection — the manifest's user object
    // doesn't carry the viewer's own departmentId today, so these tabs only
    // switch which one is highlighted; picking a specific department/team
    // still happens via AnalyticsFilterBar's own dropdowns.
  }

  return (
    <div className="flex gap-1 border-b border-border">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          className={cn(
            "border-b-2 px-3 py-2 text-sm transition-colors",
            active === v.key ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
          )}
          onClick={() => select(v.key)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
