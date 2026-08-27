"use client";

import { CalendarWorkspace } from "../../../modules/calendar/CalendarWorkspace";

// Frontend Redesign, Phase 02 — a dedicated route, replacing the generic
// `/workspace/page.calendar` catch-all as the page this module actually
// resolves to (see WorkspaceSidebar.tsx's `hrefForNavItem`). Same "kill the
// renderer module by module" pattern the home dashboard already applied in
// Phase 01. `CalendarWorkspace` is now a zero-prop, self-contained
// composite — no bind/actions to thread through here.
export default function CalendarPage() {
  return <CalendarWorkspace />;
}
