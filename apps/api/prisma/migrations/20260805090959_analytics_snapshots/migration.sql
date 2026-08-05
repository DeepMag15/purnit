-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "metric_key" TEXT NOT NULL,
    "department_id" UUID,
    "value" DOUBLE PRECISION NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL DEFAULT 'day',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_snapshots_tenant_id_metric_key_period_start_idx" ON "analytics_snapshots"("tenant_id", "metric_key", "period_start");

-- CreateIndex
CREATE INDEX "analytics_snapshots_tenant_id_metric_key_department_id_period_start_idx" ON "analytics_snapshots"("tenant_id", "metric_key", "department_id", "period_start");

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies,
-- verified verbatim against the most recent precedent
-- (20260804141420_permission_delegations).
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_snapshots
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
