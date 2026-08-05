-- CreateTable
CREATE TABLE "permission_delegations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "revoked_by_id" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permission_delegations_tenant_id_user_id_idx" ON "permission_delegations"("tenant_id", "user_id");

-- Partial unique index: at most one ACTIVE delegation per (tenant, user,
-- permission triple) — Prisma's schema DSL has no filtered/partial unique
-- constraint (same gap tenant_configs_one_active_per_tenant already works
-- around; see 20260714145938_rls_and_app_role/migration.sql). A
-- revoked-then-re-granted triple gets a brand-new row, not a reactivated one.
CREATE UNIQUE INDEX permission_delegations_active_unique
  ON permission_delegations (tenant_id, user_id, permission) WHERE revoked_at IS NULL;

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies,
-- verified verbatim against the most recent precedent (20260802140000_attendance).
ALTER TABLE permission_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_delegations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON permission_delegations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
