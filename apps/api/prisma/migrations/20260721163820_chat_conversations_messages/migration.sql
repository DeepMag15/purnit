-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_type_idx" ON "conversations"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "conversation_members_tenant_id_user_id_idx" ON "conversation_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_idx" ON "messages"("tenant_id", "conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant_isolation policy, same shape as every other tenant-scoped
-- table (see 20260714145938_rls_and_app_role/migration.sql) — this is our
-- own NestJS backend's path, keyed on the app.tenant_id session GUC
-- TenantPrismaService sets per-request.
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversation_members
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Second, additive policy — purely for Supabase Realtime's own connection,
-- which authenticates as the browser's real Supabase JWT rather than
-- through TenantPrismaService, so app.tenant_id is never set on it (see
-- ARCHITECTURE.md §4 / CONTEXT.md §9 for why our RLS is GUC-based, not
-- JWT-based, in the first place). Without this, Realtime's postgres_changes
-- would silently see zero rows for every user on these tables — dead
-- subscriptions, not an error. `tenant_id` is a real top-level claim on
-- every Supabase-minted JWT (see custom_access_token_hook migration),
-- readable here via Postgres's native auth.jwt() under a JWT-authenticated
-- connection. Purely additive: RLS policies within one command type are
-- OR'd together, so this never loosens the tenant_isolation policy above,
-- it only adds a second path that succeeds for a real member's own JWT.
CREATE POLICY realtime_membership ON conversations
  USING (
    (auth.jwt() ->> 'tenant_id')::uuid = tenant_id
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = conversations.id AND u.auth_user_id = auth.uid()
    )
  );

CREATE POLICY realtime_membership ON conversation_members
  USING (
    (auth.jwt() ->> 'tenant_id')::uuid = tenant_id
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = conversation_members.conversation_id AND u.auth_user_id = auth.uid()
    )
  );

CREATE POLICY realtime_membership ON messages
  USING (
    (auth.jwt() ->> 'tenant_id')::uuid = tenant_id
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = messages.conversation_id AND u.auth_user_id = auth.uid()
    )
  );

-- One-time Realtime enablement — makes these three tables' changes visible
-- to Supabase Realtime's postgres_changes feature. Plain SQL, applied by
-- this migration; no manual Dashboard step needed (unlike the Custom Access
-- Token hook itself, which Supabase only exposes via Dashboard/Management API).
ALTER PUBLICATION supabase_realtime ADD TABLE conversations, conversation_members, messages;
