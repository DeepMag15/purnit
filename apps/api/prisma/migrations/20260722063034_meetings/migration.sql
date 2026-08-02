-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "organizer_id" UUID NOT NULL,
    "department_id" UUID,
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "daily_room_name" TEXT NOT NULL,
    "daily_room_url" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_tenant_id_idx" ON "meetings"("tenant_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_organizer_id_idx" ON "meetings"("tenant_id", "organizer_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_department_id_idx" ON "meetings"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_scheduled_start_idx" ON "meetings"("tenant_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "meeting_participants_tenant_id_user_id_idx" ON "meeting_participants"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meeting_id_user_id_key" ON "meeting_participants"("meeting_id", "user_id");

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant_isolation policy, same shape as every other tenant-scoped
-- table (see 20260714145938_rls_and_app_role/migration.sql), applied in this
-- same migration rather than a follow-up patch — the earlier gap where
-- comments/comment_mentions/department_type_role_labels shipped without RLS
-- (20260721163636_fix_missing_rls_policies) is exactly what this avoids.
-- No realtime_membership policy and no ALTER PUBLICATION are needed here,
-- unlike chat's tables — Daily.co owns live in-call state, not our DB; these
-- tables are never subscribed to via Supabase Realtime.
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meeting_participants
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
