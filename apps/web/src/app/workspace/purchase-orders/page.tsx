"use client";

import { PurchaseOrdersWorkspace } from "../../../modules/purchase-orders/PurchaseOrdersWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.purchase-orders` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere. Coexists with the existing
// `[poId]` detail route in this same folder — standard Next.js routing.
export default function PurchaseOrdersPage() {
  return <PurchaseOrdersWorkspace />;
}
