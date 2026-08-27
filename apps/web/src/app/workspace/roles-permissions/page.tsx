"use client";

import { RolesPermissionsWorkspace } from "../../../modules/roles/RolesPermissionsWorkspace";

// Frontend Redesign, Phase 04 — a dedicated route, replacing the generic
// `/workspace/page.roles-permissions` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01/02/03 already applied elsewhere.
export default function RolesPermissionsPage() {
  return <RolesPermissionsWorkspace />;
}
