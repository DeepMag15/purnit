"use client";

import { ClientsWorkspace } from "../../../modules/clients/ClientsWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.clients` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere. Coexists with the existing
// `[clientId]` detail route in this same folder — standard Next.js routing.
export default function ClientsPage() {
  return <ClientsWorkspace />;
}
