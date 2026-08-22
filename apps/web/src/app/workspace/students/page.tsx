"use client";

import { StudentsWorkspace } from "../../../modules/students/StudentsWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.students` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere.
export default function StudentsPage() {
  return <StudentsWorkspace />;
}
