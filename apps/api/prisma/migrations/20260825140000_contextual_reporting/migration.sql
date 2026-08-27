-- Contextual Reporting: document analysis, plus two new document anchors.
--
-- The capability itself needs one table. Everything else it uses -- upload,
-- versioning, the approvalStatus review workflow, comments, text extraction
-- for txt/csv/pdf, and per-domain document anchors -- already existed.

CREATE TABLE "document_analyses" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"         UUID         NOT NULL,
  "document_id"       UUID         NOT NULL,
  "document_version"  INTEGER      NOT NULL,
  "lens_key"          TEXT         NOT NULL,
  "lens_label"        TEXT         NOT NULL,
  "summary"           TEXT         NOT NULL,
  "findings"          JSONB        NOT NULL,
  "suggested_actions" JSONB        NOT NULL,
  "provider"          TEXT         NOT NULL,
  "input_tokens"      INTEGER      NOT NULL,
  "output_tokens"     INTEGER      NOT NULL,
  "requested_by_id"   UUID         NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_analyses_tenant_id_document_id_idx"
  ON "document_analyses"("tenant_id", "document_id");

ALTER TABLE "document_analyses"
  ADD CONSTRAINT "document_analyses_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, identical policy shape to every other tenant-owned table.
ALTER TABLE document_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_analyses FORCE ROW LEVEL SECURITY;
-- NULLIF, not a bare current_setting: an unset GUC returns the empty string,
-- which fails the ::uuid cast rather than simply matching nothing. Same shape
-- as every other tenant_isolation policy in this database.
CREATE POLICY tenant_isolation ON document_analyses
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Two new document anchors. Both nullable and created lazily: enrolling 2,000
-- students must not create 2,000 empty Project rows, and students registered
-- before this shipped are backfilled on first use.
ALTER TABLE "students" ADD COLUMN "files_project_id" UUID;
CREATE UNIQUE INDEX "students_files_project_id_key" ON "students"("files_project_id");

ALTER TABLE "enrollments" ADD COLUMN "submissions_project_id" UUID;
CREATE UNIQUE INDEX "enrollments_submissions_project_id_key" ON "enrollments"("submissions_project_id");
