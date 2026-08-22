"use client";

import { SuppliersWorkspace } from "../../../modules/suppliers/SuppliersWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.suppliers` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere. Coexists with the existing
// `[supplierId]` detail route in this same folder — standard Next.js routing.
export default function SuppliersPage() {
  return <SuppliersWorkspace />;
}
