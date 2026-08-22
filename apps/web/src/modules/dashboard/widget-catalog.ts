import type { ComponentType } from "react";
import type { WorkspaceManifest } from "@purnit/manifest-schema";
import { flattenNavItems } from "../../ui/nav-tree";
import { getQuickCreateItems } from "../../lib/quick-create";
import { AgendaWidget } from "./widgets/AgendaWidget";
import { MyWorkWidget } from "./widgets/MyWorkWidget";
import { QuickActionsWidget } from "./widgets/QuickActionsWidget";
import { AnnouncementsWidget } from "./widgets/AnnouncementsWidget";
import { AiInsightsWidget } from "./widgets/AiInsightsWidget";
import { KpiStripWidget } from "./widgets/KpiStripWidget";

export interface DashboardWidgetDef {
  key: string;
  label: string;
  /** "wide" spans 2 of 3 grid columns on desktop; "full" spans all 3. */
  span: "narrow" | "wide" | "full";
  component: ComponentType;
  /** Eligibility, computed from data already on the manifest — never a new
   * permission check. Absent = always eligible. */
  isEligible?: (manifest: WorkspaceManifest) => boolean;
}

function hasNavPage(manifest: WorkspaceManifest, pageId: string): boolean {
  return flattenNavItems(manifest.navigation).some((item) => item.pageId === pageId);
}

/**
 * Frontend Redesign, Phase 01 — the role-based dashboard's widget catalog.
 * Eligibility is derived entirely from what's already on the compiled,
 * permission-pruned manifest (nav pageId presence, `aiAvailable`) — the
 * same "reuse what's already permission-pruned, don't invent a parallel
 * permission check" discipline `getQuickCreateItems` and the Command
 * Palette's nav items already follow. A role that can't see Tasks in the
 * sidebar never gets a My Work widget either.
 *
 * Deliberately fixed order/eligibility for this first pass — no saved
 * per-user layout (hide/reorder/resize) yet, unlike Analytics' own
 * `DashboardLayout`-backed editor. That's a disclosed, real gap to close
 * in a fast-follow, not an oversight: the eligibility rule below is exactly
 * what a future per-role *default* would seed, so adding persistence later
 * only touches this file's caller, not this catalog's shape.
 */
export const DASHBOARD_WIDGET_CATALOG: DashboardWidgetDef[] = [
  { key: "kpiStrip", label: "Snapshot", span: "full", component: KpiStripWidget, isEligible: (m) => hasNavPage(m, "page.tasks") },
  { key: "agenda", label: "Agenda", span: "wide", component: AgendaWidget },
  { key: "myWork", label: "My Work", span: "wide", component: MyWorkWidget, isEligible: (m) => hasNavPage(m, "page.tasks") },
  // Never-blank guard: a role with no create-worthy nav page AND no AI
  // would otherwise get a header with zero buttons under it.
  { key: "quickActions", label: "Quick Actions", span: "narrow", component: QuickActionsWidget, isEligible: (m) => getQuickCreateItems(m).length > 0 || m.aiAvailable },
  // AiInsightsWidget's entire premise is task-based insight, so its own
  // component always calls `tasks.list` — eligibility has to require
  // `page.tasks` too, not just `aiAvailable` on its own, or a role with no
  // task:read permission at all (e.g. Receptionist, Warehouse Staff) would
  // still render this widget and 403 on every fetch. Caught live-verifying
  // this exact case before shipping — not a hypothetical.
  { key: "aiInsights", label: "AI Insights", span: "narrow", component: AiInsightsWidget, isEligible: (m) => m.aiAvailable && hasNavPage(m, "page.tasks") },
  { key: "announcements", label: "Announcements", span: "narrow", component: AnnouncementsWidget, isEligible: (m) => hasNavPage(m, "page.announcements") },
];

export function eligibleWidgets(manifest: WorkspaceManifest): DashboardWidgetDef[] {
  return DASHBOARD_WIDGET_CATALOG.filter((w) => !w.isEligible || w.isEligible(manifest));
}
