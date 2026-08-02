-- Phase B (AI Assistant RAG): pgvector-backed chunk embeddings + an outbox
-- table for async embedding generation. See embedding.prisma for design notes.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding" vector(3072) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embedding_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "embeddings_tenant_id_source_type_source_id_chunk_index_key" ON "embeddings"("tenant_id", "source_type", "source_id", "chunk_index");

-- CreateIndex
CREATE INDEX "embeddings_tenant_id_source_type_source_id_idx" ON "embeddings"("tenant_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "embedding_jobs_tenant_id_status_available_at_idx" ON "embedding_jobs"("tenant_id", "status", "available_at");

-- Standard tenant_isolation policy, shipped in the same migration as each table.
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON embeddings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE embedding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON embedding_jobs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
