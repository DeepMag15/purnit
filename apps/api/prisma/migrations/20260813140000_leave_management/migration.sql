-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_annual_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "allotted_days" INTEGER NOT NULL,
    "used_days" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days_requested" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approver_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenant_id_name_key" ON "leave_types"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_tenant_id_user_id_leave_type_id_year_key" ON "leave_balances"("tenant_id", "user_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_user_id_idx" ON "leave_requests"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_approver_id_status_idx" ON "leave_requests"("tenant_id", "approver_id", "status");

-- Standard tenant_isolation policy, shipped in the same migration as the
-- tables — same discipline established since 20260721163636_fix_missing_rls_policies,
-- already followed by attendance/meetings/announcements/calendar. No
-- Realtime publication/policy needed — nothing here is subscribed to via
-- Supabase Realtime.
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_types
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_balances
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON leave_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
