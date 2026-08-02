-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "department_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_tenant_id_idx" ON "announcements"("tenant_id");

-- CreateIndex
CREATE INDEX "announcements_tenant_id_author_id_idx" ON "announcements"("tenant_id", "author_id");

-- CreateIndex
CREATE INDEX "announcements_tenant_id_department_id_idx" ON "announcements"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "announcements_tenant_id_created_at_idx" ON "announcements"("tenant_id", "created_at");

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — avoiding the earlier gap where comments/chat tables briefly went
-- live without RLS (20260721163636_fix_missing_rls_policies), same
-- discipline already established for meetings/meeting_participants.
-- No Realtime publication/policy needed — nothing here is subscribed to
-- via Supabase Realtime.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON announcements
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
