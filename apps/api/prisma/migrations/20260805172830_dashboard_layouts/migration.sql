-- CreateTable
CREATE TABLE "dashboard_layouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "role_id" UUID,
    "dashboard_key" TEXT NOT NULL DEFAULT 'analytics',
    "name" TEXT NOT NULL DEFAULT 'Default',
    "sections" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_layouts_tenant_id_user_id_idx" ON "dashboard_layouts"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "dashboard_layouts_tenant_id_role_id_idx" ON "dashboard_layouts"("tenant_id", "role_id");

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies,
-- verified verbatim against the most recent precedent (20260805090959_analytics_snapshots).
ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dashboard_layouts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
