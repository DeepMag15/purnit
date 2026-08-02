import { Injectable } from "@nestjs/common";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { assertProjectVisible } from "../../modules/documents/documents.data-sources";

const OVER_FETCH_LIMIT = 20;
const DEFAULT_RESULT_LIMIT = 6;

export interface RetrievedChunk {
  sourceType: string;
  sourceId: string;
  sourceName: string;
  content: string;
}

interface EmbeddingCandidateRow {
  id: string;
  source_type: string;
  source_id: string;
  content: string;
}

/** Two-stage tenant+scope-safe retrieval. Stage 1 (this file, raw SQL) is a
 * plain tenant-filtered nearest-neighbor query — it closes cross-tenant
 * leakage (with RLS as a second layer) but says nothing about *within*-tenant
 * scope. Stage 2 re-checks each candidate against the *same* visibility
 * function the module it came from already uses for everything else
 * (`assertProjectVisible`, reused unchanged) — this is what actually stops
 * a Lead scoped to Project A from seeing a chunk from Project B in the same
 * tenant. Never invents new authorization logic. */
@Injectable()
export class RetrievalService {
  async retrieve(
    tx: PrismaTx,
    ctx: DataSourceContext,
    queryVector: number[],
    opts?: { sourceType?: string; sourceId?: string },
    limit = DEFAULT_RESULT_LIMIT,
  ): Promise<RetrievedChunk[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;

    const candidates = await tx.$queryRawUnsafe<EmbeddingCandidateRow[]>(
      `SELECT id, source_type, source_id, content
       FROM embeddings
       WHERE tenant_id = $1
         AND ($2::text IS NULL OR source_type = $2)
         AND ($3::uuid IS NULL OR source_id = $3)
       ORDER BY embedding <=> $4::vector
       LIMIT $5`,
      ctx.tenantId,
      opts?.sourceType ?? null,
      opts?.sourceId ?? null,
      vectorLiteral,
      OVER_FETCH_LIMIT,
    );

    const results: RetrievedChunk[] = [];
    // Sequential on the shared tx, never Promise.all — same rule as every
    // other multi-query resolver against a transactional tx.
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      const sourceName = await this.checkVisibilityAndGetName(tx, ctx, candidate.source_type, candidate.source_id);
      // Stage 2 throws rather than returning boolean — a failure here is
      // routine, expected noise for an open search (the candidate simply
      // isn't visible to this actor), not an error to surface.
      if (sourceName === null) continue;
      results.push({ sourceType: candidate.source_type, sourceId: candidate.source_id, sourceName, content: candidate.content });
    }
    return results;
  }

  private async checkVisibilityAndGetName(tx: PrismaTx, ctx: DataSourceContext, sourceType: string, sourceId: string): Promise<string | null> {
    if (sourceType !== "document") return null;
    try {
      const document = await tx.document.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!document) return null;
      await assertProjectVisible(tx, ctx, document.projectId);
      return document.name;
    } catch {
      return null;
    }
  }
}
