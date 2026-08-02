import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { EmbeddingProviderService } from "./embedding-provider.service";
import { GEMINI_EMBEDDING_DIMENSIONS } from "./gemini-embedding-provider";
import { extractDocumentText } from "./document-text-extraction";
import { chunkText } from "./chunk-text";

const POLL_INTERVAL_MS = 15_000;
const JOB_BATCH_SIZE = 5;
const MAX_ATTEMPTS = 5;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 32) * 60_000;
}

interface ClaimedJob {
  id: string;
  sourceType: string;
  sourceId: string;
  attempts: number;
}

/** This codebase's first `@nestjs/schedule` consumer, and its first outbox
 * processor — document.create/finalizeReplace only enqueue a row (see
 * embedding-ingestion.ts); the actual embedding work happens here, entirely
 * out-of-band from any user-facing request.
 *
 * Tx-boundary discipline mirrors aiMessage.send's preResolve/resolve split:
 * external I/O (Storage download, the embedding API call) never runs inside
 * a `tenantPrisma.run()` transaction. Each tenant's batch is therefore three
 * separate short transactions/calls: claim (mark processing + read
 * everything tenant-scoped this job needs), do the actual work, write
 * results back (mark done/failed + upsert embeddings).
 *
 * Cross-tenant claiming: `TenantPrismaService.run()` is the only way to
 * read RLS-protected tables, and RLS requires `app.tenant_id` set per call —
 * there's no single query that can see every tenant's due jobs at once. So
 * this polls tenants in a round-robin (`tenantPrisma.root.tenant.findMany`,
 * a legitimate root-table read — Tenant has no RLS, same precedent as
 * aiMessage.send's own tenant-name lookup), then one `run()` per tenant.
 * O(tenant count) queries per tick — trivial at this platform's real scale;
 * a `SECURITY DEFINER` claim-function is the natural future upgrade if that
 * ever changes, not built now. */
@Injectable()
export class EmbeddingJobProcessorService {
  private readonly logger = new Logger(EmbeddingJobProcessorService.name);
  private running = false;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly embeddingProvider: EmbeddingProviderService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processAllTenants();
    } catch (err) {
      this.logger.error("Embedding job poll failed", err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async processAllTenants() {
    // Basic chat (Phase A) must keep working even if embeddings are
    // misconfigured independently — just skip the whole poll, not an error.
    if (!EmbeddingProviderService.isConfigured()) return;

    const tenants = await this.tenantPrisma.root.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      await this.processTenantJobs(tenant.id);
    }
  }

  private async processTenantJobs(tenantId: string) {
    const claimed = await this.tenantPrisma.run(tenantId, async (tx) => {
      const due = await tx.embeddingJob.findMany({
        where: { tenantId, status: "pending", availableAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" },
        take: JOB_BATCH_SIZE,
      });
      if (due.length === 0) return [];
      await tx.embeddingJob.updateMany({ where: { id: { in: due.map((j) => j.id) } }, data: { status: "processing" } });
      return due.map((j): ClaimedJob => ({ id: j.id, sourceType: j.sourceType, sourceId: j.sourceId, attempts: j.attempts }));
    });

    for (const job of claimed) {
      await this.processJob(tenantId, job);
    }
  }

  private async processJob(tenantId: string, job: ClaimedJob) {
    try {
      // Only "document" source-type exists in Phase B — a future source
      // type would branch here rather than replacing this.
      if (job.sourceType !== "document") {
        await this.markDone(tenantId, job.id);
        return;
      }

      const document = await this.tenantPrisma.run(tenantId, (tx) =>
        tx.document.findFirst({ where: { id: job.sourceId, tenantId, deletedAt: null } }),
      );
      // Soft-deleted or gone since the job was enqueued — nothing to embed,
      // not a failure.
      if (!document) {
        await this.markDone(tenantId, job.id);
        return;
      }

      const bytes = await this.supabaseAdmin.downloadDocumentBytes(document.storagePath);
      const text = await extractDocumentText(bytes, document.mimeType);
      if (!text) {
        await this.markDone(tenantId, job.id);
        return;
      }

      const chunks = chunkText(text);
      const existingHashes = await this.tenantPrisma.run(tenantId, async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{ chunk_index: number; content_hash: string }>>(
          `SELECT chunk_index, content_hash FROM embeddings WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3`,
          tenantId,
          job.sourceType,
          job.sourceId,
        );
        return new Map(rows.map((r) => [r.chunk_index, r.content_hash]));
      });

      const changed = chunks
        .map((content, chunkIndex) => ({ chunkIndex, content, contentHash: sha256(content) }))
        .filter((c) => existingHashes.get(c.chunkIndex) !== c.contentHash);

      if (changed.length > 0) {
        // Batched — one embed() call for everything that changed, not one
        // per chunk.
        const { vectors } = await this.embeddingProvider.embed({ texts: changed.map((c) => c.content), taskType: "document" });

        await this.tenantPrisma.run(tenantId, async (tx) => {
          for (let i = 0; i < changed.length; i++) {
            const c = changed[i]!;
            const vector = vectors[i]!;
            if (vector.length !== GEMINI_EMBEDDING_DIMENSIONS) {
              throw new Error(`Expected a ${GEMINI_EMBEDDING_DIMENSIONS}-dim embedding, got ${vector.length}`);
            }
            await tx.$executeRawUnsafe(
              `INSERT INTO embeddings (tenant_id, source_type, source_id, chunk_index, content, content_hash, embedding, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7::vector, now())
               ON CONFLICT (tenant_id, source_type, source_id, chunk_index)
               DO UPDATE SET content = $5, content_hash = $6, embedding = $7::vector, updated_at = now()`,
              tenantId,
              job.sourceType,
              job.sourceId,
              c.chunkIndex,
              c.content,
              c.contentHash,
              `[${vector.join(",")}]`,
            );
          }
          // A replace shorter than the original leaves trailing stale chunks.
          await tx.$executeRawUnsafe(
            `DELETE FROM embeddings WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3 AND chunk_index >= $4`,
            tenantId,
            job.sourceType,
            job.sourceId,
            chunks.length,
          );
        });
      }

      await this.markDone(tenantId, job.id);
    } catch (err) {
      await this.markFailed(tenantId, job.id, job.attempts, err);
    }
  }

  private async markDone(tenantId: string, jobId: string) {
    await this.tenantPrisma.run(tenantId, (tx) => tx.embeddingJob.update({ where: { id: jobId }, data: { status: "done" } }));
  }

  private async markFailed(tenantId: string, jobId: string, priorAttempts: number, err: unknown) {
    const attempts = priorAttempts + 1;
    const lastError = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Embedding job ${jobId} failed (attempt ${attempts}): ${lastError}`);

    await this.tenantPrisma.run(tenantId, (tx) =>
      tx.embeddingJob.update({
        where: { id: jobId },
        data:
          attempts >= MAX_ATTEMPTS
            ? { status: "failed", attempts, lastError }
            : { status: "pending", attempts, lastError, availableAt: new Date(Date.now() + backoffMs(attempts)) },
      }),
    );
  }
}
