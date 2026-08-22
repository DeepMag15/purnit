import type { BlueprintDefinition } from "@purnit/manifest-schema";

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

/**
 * Feature Flags — a per-tenant override layered directly on top of the
 * plan's own entitlements, reusing `filterByEntitlements`'s existing
 * `moduleKey` mechanism rather than a second filtering pass over
 * navigation/pages. An explicit `enabled: false` flag hides a module even
 * if the plan allows it (a kill-switch); an explicit `enabled: true` flag
 * shows one even if the plan wouldn't (an early-access override). A flag
 * whose key doesn't match any of the blueprint's own module keys is simply
 * inert here — it's still exposed via the compiled manifest's own
 * `featureFlags` map for any component that wants to check a single key
 * directly, independent of module-level gating.
 *
 * Returns the *effective* entitled-module-keys list to pass into
 * `filterByEntitlements` — `flags` never touches navigation/pages itself.
 * Preserves the `null` ("nothing to filter") fast path when no flag
 * actually overrides one of this blueprint's own module keys, same
 * "avoid work when there's nothing to do" discipline `filterByEntitlements`
 * itself already follows.
 */
export function applyFeatureFlagOverrides(
  allModuleKeys: readonly string[],
  entitledModuleKeys: string[] | null,
  flags: Record<string, boolean>,
): string[] | null {
  const hasOverride = allModuleKeys.some((key) => key in flags);
  if (!hasOverride) return entitledModuleKeys;

  const effective = new Set(entitledModuleKeys ?? allModuleKeys);
  for (const key of allModuleKeys) {
    if (flags[key] === true) effective.add(key);
    if (flags[key] === false) effective.delete(key);
  }
  return [...effective];
}
