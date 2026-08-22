"use client";

import { WorkspaceSettings } from "../../../modules/settings/WorkspaceSettings";

// Frontend Redesign, Phase 04 — a dedicated route, replacing the generic
// `/workspace/page.settings` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01/02/03 already applied elsewhere.
export default function SettingsPage() {
  return <WorkspaceSettings />;
}
