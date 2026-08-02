import type { NavItem } from "@antigravity/manifest-schema";

/** Depth-first flatten of a (already permission-pruned) nav tree — every
 * node, groups and leaves alike. Shared by every consumer that used to
 * assume `manifest.navigation` was flat (the command palette, QuickActions'
 * own visibility check) so nested items don't silently go missing from them. */
export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => (item.children ? [item, ...flattenNavItems(item.children)] : [item]));
}
