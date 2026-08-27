-- Module review, Projects: tell a real project from plumbing.
--
-- Four of five domains have no Projects module; a Project backs each domain
-- entity so Documents/Comments/Tasks attach through machinery that already
-- resolves scope. But `projects.list` returned those rows as user-facing
-- Projects, so a Nurse creating a Care Task picked from a dropdown reading
-- "Chart: J. Chen" -- internal names never meant to be seen.

ALTER TABLE "projects" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'project';

-- Every project-shaped read filters on this.
CREATE INDEX "projects_tenant_id_kind_idx" ON "projects"("tenant_id", "kind");

-- Backfill from the entity that owns each backing project. Rows created before
-- this migration must be classified too, or the leak simply persists for every
-- existing workspace.
UPDATE "projects" p SET "kind" = 'chart'
  FROM "patients" x WHERE x."chart_project_id" = p."id";

UPDATE "projects" p SET "kind" = 'materials'
  FROM "courses" x WHERE x."materials_project_id" = p."id";

UPDATE "projects" p SET "kind" = 'clientFiles'
  FROM "clients" x WHERE x."files_project_id" = p."id";

UPDATE "projects" p SET "kind" = 'itemFiles'
  FROM "inventory_items" x WHERE x."files_project_id" = p."id";

UPDATE "projects" p SET "kind" = 'submissions'
  FROM "enrollments" x WHERE x."submissions_project_id" = p."id";

UPDATE "projects" p SET "kind" = 'studentFile'
  FROM "students" x WHERE x."files_project_id" = p."id";
