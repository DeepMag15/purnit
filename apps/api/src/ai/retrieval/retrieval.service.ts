import { Injectable } from "@nestjs/common";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { RagSourceRegistry } from "./rag-source-registry.service";

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
 * logic the module it came from already uses for everything else, via
 * `RagSourceRegistry` (AI RAG Phase C) — never invents new authorization
 * logic, just dispatches to whichever module registered that `sourceType`. */
@Injectable()
export class RetrievalService {
  constructor(private readonly ragSources: RagSourceRegistry) {}

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

    // AI Assistant Phase F — group by source_type first, so a handler that
    // implements the optional batch method gets exactly one round trip for
    // every one of its candidates in this over-fetched set, rather than one
    // per candidate. Every handler without a batch method still resolves
    // sequentially, byte-for-byte the same as before this phase — this is
    // purely a query-shape change, not a new authorization path.
    //
    // Deliberate, disclosed trade-off: the old per-candidate loop had an
    // early-exit (`if (results.length >= limit) break`) that often avoided
    // checking every one of the up-to-20 over-fetched candidates. Resolving
    // the whole set's visibility up front trades "a few extra rows checked
    // that early-exit might have skipped" for "collapsing up to 20 sequential
    // round trips into a handful of grouped queries" — a clear net win since
    // round-trip latency, not row count, is the real cost here, but a real
    // behavior change in *how much* visibility-checking work happens per
    // call, not a purely mechanical one.
    const groups = new Map<string, EmbeddingCandidateRow[]>();
    for (const candidate of candidates) {
      const group = groups.get(candidate.source_type);
      if (group) group.push(candidate);
      else groups.set(candidate.source_type, [candidate]);
    }

    const nameById = new Map<string, string>();
    // Sequential across groups, on the shared tx, never Promise.all — same
    // rule as every other multi-query resolver against a transactional tx.
    for (const [sourceType, group] of groups) {
      const handler = this.ragSources.get(sourceType);
      if (!handler) continue;
      if (handler.checkVisibilityAndGetNames) {
        try {
          const names = await handler.checkVisibilityAndGetNames(
            tx,
            ctx,
            group.map((c) => c.source_id),
          );
          for (const [id, name] of names) nameById.set(id, name);
        } catch {
          // Same "routine, expected noise for an open search" treatment as
          // the per-candidate catch below — a failure here fails the whole
          // group closed (none of its candidates survive), not an error to
          // surface, and never affects any other group.
        }
      } else {
        for (const candidate of group) {
          const name = await this.checkVisibilityAndGetName(tx, ctx, sourceType, candidate.source_id);
          if (name !== null) nameById.set(candidate.source_id, name);
        }
      }
    }

    const results: RetrievedChunk[] = [];
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      const sourceName = nameById.get(candidate.source_id);
      if (sourceName === undefined) continue;
      results.push({ sourceType: candidate.source_type, sourceId: candidate.source_id, sourceName, content: candidate.content });
    }
    return results;
  }

  private async checkVisibilityAndGetName(tx: PrismaTx, ctx: DataSourceContext, sourceType: string, sourceId: string): Promise<string | null> {
    const handler = this.ragSources.get(sourceType);
    if (!handler) return null;
    try {
      return await handler.checkVisibilityAndGetName(tx, ctx, sourceId);
    } catch {
      return null;
    }
  }
}
