-- Projects ecosystem review: submit -> review -> approval, and evidence that
-- attaches to the work it evidences.
--
-- Before this a person was given work, did it, and marked it done themselves.
-- Nothing was submitted, nobody reviewed it, and Task.status was free text --
-- "in_review" was accepted by the API and understood by nothing else.

ALTER TABLE "tasks" ADD COLUMN "submitted_by_id" UUID;
ALTER TABLE "tasks" ADD COLUMN "submitted_at"    TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "reviewed_by_id"  UUID;
ALTER TABLE "tasks" ADD COLUMN "reviewed_at"     TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "review_note"     TEXT;

-- Reviewers open "what is waiting on me" constantly; everything else filters
-- tasks by project or assignee, both already indexed.
CREATE INDEX "tasks_tenant_id_status_idx" ON "tasks"("tenant_id", "status");

-- Evidence. Nullable because most documents are not evidence for anything --
-- course materials, contracts, a patient's scan. The project stays the owner
-- and is what governs access; this only records which work produced the file.
ALTER TABLE "documents" ADD COLUMN "task_id" UUID;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "documents_tenant_id_task_id_idx" ON "documents"("tenant_id", "task_id");
