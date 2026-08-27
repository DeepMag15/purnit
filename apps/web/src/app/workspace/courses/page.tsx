"use client";

import { CoursesWorkspace } from "../../../modules/courses/CoursesWorkspace";

// Frontend Redesign, Phase 05 — a dedicated route, replacing the generic
// `/workspace/page.courses` catch-all (see WorkspaceSidebar.tsx's
// `hrefForNavItem`). Same "kill the renderer module by module" pattern
// Phase 01-04 already applied elsewhere. Coexists with the existing
// `[courseId]` detail route in this same folder — standard Next.js routing.
export default function CoursesPage() {
  return <CoursesWorkspace />;
}
