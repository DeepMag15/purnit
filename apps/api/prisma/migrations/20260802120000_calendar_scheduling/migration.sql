-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "department_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_idx" ON "calendar_events"("tenant_id");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_author_id_idx" ON "calendar_events"("tenant_id", "author_id");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_department_id_idx" ON "calendar_events"("tenant_id", "department_id");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_start_at_idx" ON "calendar_events"("tenant_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_reminders_tenant_id_status_available_at_idx" ON "calendar_reminders"("tenant_id", "status", "available_at");

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies,
-- already followed by meetings/announcements. No Realtime publication/policy
-- needed — nothing here is subscribed to via Supabase Realtime.
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calendar_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE calendar_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON calendar_reminders
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
