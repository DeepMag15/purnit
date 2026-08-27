import type { Scope } from "@purnit/manifest-schema";

export interface ScopeCheckSubject {
  ownerId?: string | null;
  departmentId?: string | null;
}

export interface ScopeCheckActor {
  userId: string;
  departmentId?: string | null;
  /** Precomputed via `getDepartmentSubtreeIds` — the actor's own department
   * plus every descendant, walking `Department.parentId` down. Only ever
   * populated by a caller that actually resolved `"department-subtree"`
   * scope (see `department-subtree.ts`'s doc comment for why this stays a
   * separate, on-demand step rather than making this function async). */
  departmentSubtreeIds?: string[];
}

/**
 * Given a granted scope (from PermissionResolverService.has()) and the row
 * being accessed, decides whether the actor may act on *this specific row*.
 * `has()` only tells you the broadest scope granted for resource:action —
 * this is the second half: does that scope actually cover this row.
 *
 * Simplification (Phase 1): `Project` (the only row type this guards so
 * far) has no `teamId` column, only `departmentId` — "team" and
 * "department" scope currently resolve identically. Revisit if/when a row
 * type needs genuine team-level granularity.
 *
 * ⚠️ "own" is always a floor under "team"/"department", not a separate,
 * exclusive axis — a real bug, user-reported: a task assigned to someone
 * with only `team` scope was invisible/un-actionable to them whenever the
 * task's project didn't happen to match their department (e.g. the project
 * had no department set at all). Ownership/assignment is a *narrower*,
 * always-included relationship a broader scope should never exclude —
 * department match is an *additional* way to be in scope, not the only one
 * once you already own/are-assigned the row. Fixed by checking ownership
 * first regardless of which of the two broader-scope branches applies.
 */
export function isRowInScope(scope: Scope, subject: ScopeCheckSubject, actor: ScopeCheckActor): boolean {
  switch (scope) {
    case "tenant":
      return true;
    case "department-subtree":
      return (
        (subject.ownerId != null && subject.ownerId === actor.userId) ||
        (subject.departmentId != null && (actor.departmentSubtreeIds?.includes(subject.departmentId) ?? false))
      );
    case "department":
    case "team":
      return (subject.ownerId != null && subject.ownerId === actor.userId) || (subject.departmentId != null && subject.departmentId === actor.departmentId);
    case "own":
      return subject.ownerId === actor.userId;
  }
}
