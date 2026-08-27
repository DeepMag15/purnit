"use client";

import { AnalyticsDashboard } from "../../../modules/analytics/AnalyticsDashboard";

// Frontend Redesign, Phase 03 — a dedicated route, replacing the generic
// `/workspace/page.analytics` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01/02 already applied elsewhere.
export default function AnalyticsPage() {
  return <AnalyticsDashboard />;
}
