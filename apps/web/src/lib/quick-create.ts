import type { WorkspaceManifest } from "@purnit/manifest-schema";
import { flattenNavItems } from "../ui/nav-tree";

export interface QuickCreateItem {
  id: string;
  label: string;
  icon: string;
  href: string;
}

/**
 * Frontend Redesign, Phase 01 — shared by the header's quick-create menu,
 * the Command Palette's quick actions, and the dashboard's Quick Actions
 * widget, so the three surfaces can never drift out of sync. Derived
 * entirely from `manifest.navigation`'s own already-permission-pruned
 * pageId presence, not a new permission check — a role that can't see
 * Tasks in the sidebar never gets a "New Task" quick action either.
 * `?compose=1` is picked up by TaskList/ProjectBoard on mount to
 * auto-open the create dialog each already has.
 */
export function getQuickCreateItems(manifest: WorkspaceManifest): QuickCreateItem[] {
  const flat = flattenNavItems(manifest.navigation);
  const hasPage = (pageId: string) => flat.some((item) => item.pageId === pageId);
  const items: QuickCreateItem[] = [];
  if (hasPage("page.tasks")) items.push({ id: "task", label: "New Task", icon: "task_alt", href: "/workspace/page.tasks?compose=1" });
  if (hasPage("page.projects")) items.push({ id: "project", label: "New Project", icon: "layers", href: "/workspace/page.projects?compose=1" });
  // Frontend Redesign, Phase 02 — Meetings moved off the catch-all onto a
  // real route; this file builds hrefs directly rather than through
  // `hrefForNavItem` (WorkspaceSidebar.tsx), so it needs its own update
  // whenever a module referenced here migrates off the catch-all.
  if (hasPage("page.meetings")) items.push({ id: "meeting", label: "New Meeting", icon: "groups", href: "/workspace/meetings" });
  return items;
}
