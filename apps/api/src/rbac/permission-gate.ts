import type { EffectivePermissions } from "./permission-collapse";

/** Presence-only permission check — "resource:action" gates whether an
 * element is visible at all, independent of row-level scope (which is a
 * separate concern, handled by each consumer's own *Where()/isRowInScope()
 * call). Absent `requiredPermission` means visible to everyone.
 *
 * Extracted from config-engine/permission-pruner.ts's own private
 * `isAllowed` (which now imports this instead of keeping its own copy — zero
 * behavior change) so the Analytics engine's per-widget pruning
 * (analytics.dashboard's resolve loop) can reuse the exact same predicate
 * rather than reimplementing it — there's no static UINode tree for a
 * zero-prop composite's internal widgets, so pruneNode's tree-walk doesn't
 * apply, but the underlying "is this permission granted" check is identical. */
export function isPermissionGranted(requiredPermission: string | undefined, effective: EffectivePermissions): boolean {
  if (!requiredPermission) return true;
  const [resource, action] = requiredPermission.split(":");
  return effective.has(resource!, action!) !== null;
}
