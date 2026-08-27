-- CreateTable
CREATE TABLE "ai_tool_call_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "mutation_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ai_tool_call_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_call_proposals_message_id_key" ON "ai_tool_call_proposals"("message_id");

-- CreateIndex
CREATE INDEX "ai_tool_call_proposals_tenant_id_conversation_id_idx" ON "ai_tool_call_proposals"("tenant_id", "conversation_id");

-- AddForeignKey
ALTER TABLE "ai_tool_call_proposals" ADD CONSTRAINT "ai_tool_call_proposals_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant_isolation policy, shipped in the same migration as the
-- table — same discipline established since 20260721163636_fix_missing_rls_policies.
ALTER TABLE ai_tool_call_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_call_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_tool_call_proposals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
