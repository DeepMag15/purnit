-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "type" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "manager_id" UUID;

-- CreateTable
CREATE TABLE "department_type_role_labels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "department_type" TEXT NOT NULL,
    "source_blueprint_role_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "override_role_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_type_role_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "department_type_role_labels_tenant_id_idx" ON "department_type_role_labels"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_type_role_labels_tenant_id_department_type_sourc_key" ON "department_type_role_labels"("tenant_id", "department_type", "source_blueprint_role_id");
