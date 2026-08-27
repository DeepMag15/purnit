import type { NavItem, WorkspaceManifest } from "@purnit/manifest-schema";
import { hrefForNavItem } from "./WorkspaceSidebar";

/** Depth-first flatten of a (already permission-pruned) nav tree — every
 * node, groups and leaves alike. Shared by every consumer that used to
 * assume `manifest.navigation` was flat (the command palette, QuickActions'
 * own visibility check) so nested items don't silently go missing from them. */
export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => (item.children ? [item, ...flattenNavItems(item.children)] : [item]));
}

/** DFS ancestor chain (root-first, inclusive of the matched item) for the
 * page the router's own `pathname` currently points at — matches via
 * `hrefForNavItem`, the same technique `WorkspaceSidebar`'s own
 * `containsActiveHref` already uses, not raw `pageId` comparison, since the
 * current page tracks `pathname` (live), not `manifest.page.id` (stale
 * after any client-side navigation). Returns `[]` if `pathname` isn't
 * reachable from this nav tree at all. */
export function findNavPath(items: NavItem[], manifest: WorkspaceManifest, pathname: string): NavItem[] {
  for (const item of items) {
    if (hrefForNavItem(manifest, item.pageId) === pathname) return [item];
    if (item.children) {
      const childPath = findNavPath(item.children, manifest, pathname);
      if (childPath.length > 0) return [item, ...childPath];
    }
  }
  return [];
}
