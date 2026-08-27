"use client";

import { HomeDashboard } from "../../modules/dashboard/HomeDashboard";

// Frontend Redesign, Phase 01 — the landing route no longer renders the
// generic, server-compiled `manifest.page` JSON blueprint through the SDUI
// Renderer; it renders the purpose-built, role-shaped HomeDashboard instead
// (see that component's own doc comment). `manifest.page` is still compiled
// server-side (no backend change made or needed for this), just unused here
// now — a small, accepted inefficiency, not a bug.
export default function WorkspaceHomePage() {
  return <HomeDashboard />;
}
