"use client";

import { OrgStructure } from "../../../modules/hr/OrgStructure";

// Frontend Redesign, Phase 04 — a dedicated route, replacing the generic
// `/workspace/page.hr` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01/02/03 already applied elsewhere.
export default function HrPage() {
  return <OrgStructure />;
}
