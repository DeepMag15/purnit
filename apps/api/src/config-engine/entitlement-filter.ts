import type { BlueprintDefinition } from "@antigravity/manifest-schema";

/**
 * Layer 3 (entitlements) — drops modules/nav a plan doesn't unlock, per
 * ARCHITECTURE.md §10: "a locked module never reaches any user's manifest."
 *
 * `entitledModuleKeys: null` means the tenant has no plan assigned — Phase 1's
 * default (no billing wall yet; see ARCHITECTURE.md §10/CHANGELOG Session 1),
 * so everything in the blueprint is entitled. Pages aren't filtered directly
 * here: once nav is filtered, a page with no reachable nav entry is simply
 * unreachable — sufficient for Phase 1, revisit if a page needs hiding
 * without removing its nav item.
 */
export function filterByEntitlements(
  resolved: BlueprintDefinition,
  entitledModuleKeys: string[] | null,
): BlueprintDefinition {
  if (entitledModuleKeys === null) return resolved;

  const modules = resolved.modules.filter((m) => entitledModuleKeys.includes(m));
  const navigation = resolved.navigation.filter((n) => !n.moduleKey || entitledModuleKeys.includes(n.moduleKey));

  return { ...resolved, modules, navigation };
}
