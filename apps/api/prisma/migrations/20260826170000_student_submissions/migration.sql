-- Documents module review (2026-08-26) — the Education submission link.
--
-- A student's submission is an ordinary Task in their own restricted
-- submissions project, reviewed through the same submit/review pair every
-- other domain uses. This column ties that task back to the Assignment it
-- answers. Nullable, and null for every task outside Education.
ALTER TABLE "tasks" ADD COLUMN "assignment_id" UUID;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- One submission task per student per assignment. The uniqueness lives on
-- (assignment, assignee) rather than being enforced only in application code,
-- because a double-submit race would otherwise leave two tasks and a teacher
-- reviewing whichever they happened to open.
CREATE UNIQUE INDEX "tasks_assignment_id_assignee_id_key"
  ON "tasks" ("assignment_id", "assignee_id")
  WHERE "assignment_id" IS NOT NULL AND "deleted_at" IS NULL;
