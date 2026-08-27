-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "ai_message_daily_cap" INTEGER;

-- CreateIndex
CREATE INDEX "ai_messages_tenant_id_role_created_at_idx" ON "ai_messages"("tenant_id", "role", "created_at");
