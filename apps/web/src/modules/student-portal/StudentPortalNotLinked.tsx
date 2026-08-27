"use client";

import { EmptyStateView } from "../../sdui/primitives/EmptyState";

/**
 * Student Role — the one state a student portal must explain rather than
 * blank out: a Student login that was never bound to a student record.
 *
 * `requireOwnStudent` throws a 403 with a specific message for exactly this
 * case, because the alternative — returning an empty list — sends the student
 * to their school office saying "it's just empty", which nobody can act on.
 */
export function StudentPortalNotLinked() {
  return (
    <div className="mx-auto w-full max-w-2xl pt-6">
      <EmptyStateView
        icon="school"
        message="Your account isn't linked to a student record yet. Your school needs to connect this login to your student profile before your courses, assignments and progress appear — ask the school office or your registrar."
      />
    </div>
  );
}

/** True for the specific "not linked" refusal, so the portal can show the
 * explanation above instead of a generic error. Matched on the message rather
 * than a code because the data-source layer surfaces plain `Error`s. */
export function isNotLinkedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("isn't linked to a student record");
}
