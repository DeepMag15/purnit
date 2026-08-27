-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company_name" TEXT,
    "owner_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "value_cents" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "owner_id" UUID,
    "expected_close_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contacts_tenant_id_idx" ON "crm_contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "crm_contacts_tenant_id_owner_id_idx" ON "crm_contacts"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "crm_deals_tenant_id_contact_id_idx" ON "crm_deals"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "crm_deals_tenant_id_stage_idx" ON "crm_deals"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "crm_deals_tenant_id_owner_id_idx" ON "crm_deals"("tenant_id", "owner_id");

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant_isolation policy, shipped in the same migration as each
-- table — same discipline established since 20260721163636_fix_missing_rls_policies,
-- already followed by attendance/leave/finance's own clients+invoices+payments.
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_contacts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_deals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
