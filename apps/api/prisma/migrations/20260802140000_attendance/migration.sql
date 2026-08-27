-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "marked_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_tenant_id_user_id_date_key" ON "attendance_records"("tenant_id", "user_id", "date");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_idx" ON "attendance_records"("tenant_id");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_date_idx" ON "attendance_records"("tenant_id", "date");

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies,
-- already followed by meetings/announcements/calendar. No Realtime
-- publication/policy needed — nothing here is subscribed to via Supabase
-- Realtime.
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_records
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
