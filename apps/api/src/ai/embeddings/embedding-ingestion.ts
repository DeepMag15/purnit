import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isExtractable } from "./document-text-extraction";

/** Mirrors documents.mutations.ts's own `logActivity` shape exactly — a
 * plain function, not a service, called as the last line of a mutation's
 * `resolve()`. Only inserts a job row (cheap, in-transaction); the actual
 * embedding work is entirely out-of-band, handled later by
 * EmbeddingJobProcessorService. No-ops for MIME types Phase B doesn't
 * extract text from — see document-text-extraction.ts's allowlist. */
export async function enqueueEmbeddingJob(tx: PrismaTx, tenantId: string, sourceType: string, sourceId: string, mimeType: string) {
  if (!isExtractable(mimeType)) return;
  await tx.embeddingJob.create({ data: { tenantId, sourceType, sourceId } });
}
