import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isExtractable } from "./document-text-extraction";

/** Mirrors documents.mutations.ts's own `logActivity` shape exactly — a
 * plain function, not a service, called as the last line of a mutation's
 * `resolve()`. Only inserts a job row (cheap, in-transaction); the actual
 * embedding work is entirely out-of-band, handled later by
 * EmbeddingJobProcessorService (dispatched per `sourceType` via
 * `RagSourceRegistry`, AI RAG Phase C). */
export async function enqueueEmbeddingJob(tx: PrismaTx, tenantId: string, sourceType: string, sourceId: string): Promise<void> {
  await tx.embeddingJob.create({ data: { tenantId, sourceType, sourceId } });
}

/** Document-specific wrapper around the generic `enqueueEmbeddingJob` above
 * — the only source type with a MIME type to gate on (Phase B's original
 * `isExtractable` allowlist). Every other module's own mutations call
 * `enqueueEmbeddingJob` directly; this exists purely to keep
 * `documents.mutations.ts`'s two call sites unchanged in shape. */
export async function enqueueDocumentEmbeddingJob(tx: PrismaTx, tenantId: string, sourceId: string, mimeType: string): Promise<void> {
  if (!isExtractable(mimeType)) return;
  await enqueueEmbeddingJob(tx, tenantId, "document", sourceId);
}
