-- The document access boundary.
--
-- `project:read:tenant` returned every project in the workspace, and every
-- domain entity is backed by a real Project -- so patient charts, student
-- submissions and registrar student-files were readable by anyone holding that
-- grant. Documents live on those projects, so documents.list and
-- document.getFileUrl inherited exactly the same reach.
--
-- A restricted project is reachable only by its owner, its members, or a caller
-- holding its declared access_permission. Unrestricted projects are unchanged.

ALTER TABLE "projects" ADD COLUMN "restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN "access_permission" TEXT;

-- Every read of a restricted project filters on this, so it is on the hot path
-- of every document list in the product.
CREATE INDEX "projects_tenant_id_restricted_idx" ON "projects"("tenant_id", "restricted");

-- Backfill: rows created before this migration carry the same protection as
-- ones created after it. Without this the boundary would apply only to new
-- data, which is the failure mode that makes a security fix look done while
-- leaving every existing record exposed.

-- Patient charts -- clinical. `patient:update` is the clinical floor (Doctor
-- and Nurse hold it; Receptionist does not).
UPDATE "projects" p
   SET "restricted" = true, "access_permission" = 'patient:update'
  FROM "patients" pa
 WHERE pa."chart_project_id" = p."id";

-- Student submissions -- a student's own work. No access_permission: no role
-- should read every student's submissions, so owner (the student) or member
-- (the marking teacher) are the only ways in.
UPDATE "projects" p
   SET "restricted" = true
  FROM "enrollments" e
 WHERE e."submissions_project_id" = p."id";

-- Registrar student files -- enrolment paperwork, not teaching material.
UPDATE "projects" p
   SET "restricted" = true, "access_permission" = 'student:update'
  FROM "students" s
 WHERE s."files_project_id" = p."id";
