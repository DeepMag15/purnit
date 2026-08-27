import type { EffectivePermissions } from "../rbac/permission-collapse";
import { isPermissionGranted as isAllowed } from "../rbac/permission-gate";
import type { BlueprintDefinition, NavItem, UINode } from "@purnit/manifest-schema";

export function pruneNavItems(items: NavItem[], effective: EffectivePermissions): NavItem[] {
  return items
    .filter((item) => isAllowed(item.requiredPermission, effective))
    .map((item) => (item.children ? { ...item, children: pruneNavItems(item.children, effective) } : item))
    // A pure disclosure group (no pageId of its own) that lost every child to
    // pruning above must not survive as a dangling, empty header — "prune,
    // not hide" applies to groups too, not just individual leaves.
    .filter((item) => item.pageId !== undefined || (item.children?.length ?? 0) > 0);
}

function pruneNode(node: UINode, effective: EffectivePermissions): UINode {
  const actions = node.actions?.filter((a) => isAllowed(a.requiredPermission, effective));
  const children = node.children
    ?.filter((c) => isAllowed(c.requiredPermission, effective))
    .map((c) => pruneNode(c, effective));

  return {
    ...node,
    ...(actions !== undefined ? { actions } : {}),
    ...(children !== undefined ? { children } : {}),
  };
}

/**
 * Layer 4 (identity/permissions) — removes any nav item, widget, or action a
 * user lacks the permission for, per ARCHITECTURE.md §6.5. **Prune, not
 * hide**: the disallowed element is absent from the returned tree entirely,
 * not present-but-disabled — the client physically cannot enumerate what it
 * isn't allowed to see (§6.4's core invariant).
 *
 * `onlyPageId` (performance pass 2, CONTEXT.md §48): both real callers —
 * `compilePage` (one page, by definition) and `compileWorkspace` (only ever
 * reads `pages[dashboards.default]`) — never actually need more than one
 * page's tree pruned, but this used to walk (`pruneNode`) *every* page in
 * the blueprint on every single call regardless. Passing the one page id
 * that's actually needed skips pruning every other page's tree entirely;
 * omitting it preserves the original full-blueprint behavior (e.g. for any
 * future caller, or existing test fixtures, that genuinely need all pages).
 */
export function pruneByPermissions(resolved: BlueprintDefinition, effective: EffectivePermissions, onlyPageId?: string): BlueprintDefinition {
  const navigation = pruneNavItems(resolved.navigation, effective);
  const pageEntries = onlyPageId ? Object.entries(resolved.pages).filter(([id]) => id === onlyPageId) : Object.entries(resolved.pages);
  const pages = Object.fromEntries(
    pageEntries
      // A page's own root `requiredPermission` gates the page itself, not
      // just its actions/children (which `pruneNode` already handles below)
      // — otherwise a page absent from the pruned nav above could still be
      // fetched whole by a direct `GET /api/workspace/pages/:pageId`, out of
      // sync with what the sidebar shows. Same "prune, not hide" invariant,
      // applied one level higher.
      .filter(([, page]) => isAllowed(page.requiredPermission, effective))
      .map(([id, page]) => [id, pruneNode(page, effective)]),
  );
  return { ...resolved, navigation, pages };
}
