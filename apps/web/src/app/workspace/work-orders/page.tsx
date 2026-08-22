"use client";

import { WorkOrdersWorkspace } from "../../../modules/work-orders/WorkOrdersWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.work-orders` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere. Coexists with the existing
// `[woId]` detail route in this same folder — standard Next.js routing.
export default function WorkOrdersPage() {
  return <WorkOrdersWorkspace />;
}
