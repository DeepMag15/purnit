"use client";

import { PatientsWorkspace } from "../../../modules/patients/PatientsWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.patients` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere.
export default function PatientsPage() {
  return <PatientsWorkspace />;
}
