-- Enterprise SSO/SAML (self-hosted Keycloak identity broker). No per-tenant
-- IdP secrets live in this table or anywhere else in this database — those
-- live inside Keycloak's own database, configured per tenant via its Admin
-- Console. This table only holds non-secret routing/config.

-- CreateTable
CREATE TABLE "sso_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "idp_alias" TEXT NOT NULL,
    "display_name" TEXT,
    "default_role_id" UUID,
    "require_email_verified" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sso_configs_tenant_id_key" ON "sso_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_configs_idp_alias_key" ON "sso_configs"("idp_alias");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "sso_provisioned" BOOLEAN NOT NULL DEFAULT false;

-- Row-Level Security — identical tenant_isolation template every other
-- tenant-scoped table gets (see migration 20260714145938_rls_and_app_role).
-- The existing blanket app_runtime grant on ALL TABLES already covers this
-- new table; no additional GRANT needed.
ALTER TABLE sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sso_configs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
