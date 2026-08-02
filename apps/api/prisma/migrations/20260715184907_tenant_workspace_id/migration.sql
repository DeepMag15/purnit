-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "workspace_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_workspace_id_key" ON "tenants"("workspace_id");
