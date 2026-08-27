-- Healthcare Domain, Phase A — the platform's first non-IT industry
-- blueprint. Two new tables: Patient (owns a 1:1 "chart" Project, no FK
-- declared for chart_project_id — same no-FK, app-layer-scoped-target
-- convention already used for Task.assigneeId/Meeting.organizerId) and
-- Appointment (a real FK to patients, since Patient is new/healthcare-only
-- with no cross-module reuse concern the way User/Project avoid FKs for).

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "chart_project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assigned_doctor_id" UUID,
    "registered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patients_chart_project_id_key" ON "patients"("chart_project_id");

-- CreateIndex
CREATE INDEX "patients_tenant_id_idx" ON "patients"("tenant_id");

-- CreateIndex
CREATE INDEX "patients_tenant_id_assigned_doctor_id_idx" ON "patients"("tenant_id", "assigned_doctor_id");

-- CreateIndex
CREATE INDEX "patients_tenant_id_status_idx" ON "patients"("tenant_id", "status");

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "booked_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_patient_id_idx" ON "appointments"("tenant_id", "patient_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_doctor_id_idx" ON "appointments"("tenant_id", "doctor_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_scheduled_start_idx" ON "appointments"("tenant_id", "scheduled_start");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies.
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON patients
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
