"use client";

import { InventoryItemsWorkspace } from "../../../modules/inventory-items/InventoryItemsWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.inventory-items` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere. Coexists with the existing
// `[itemId]` detail route in this same folder — standard Next.js routing.
export default function InventoryItemsPage() {
  return <InventoryItemsWorkspace />;
}
