import { Injectable } from "@nestjs/common";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

export interface RagSourceHandler {
  sourceType: string;
  /** Stage-2 retrieval-time check — identical contract to what
   * `RetrievalService` inlined before this registry existed: null = not
   * visible/not found, never throws out to the caller (`RetrievalService`
   * still wraps every call in its own try/catch). */
  checkVisibilityAndGetName(tx: PrismaTx, ctx: DataSourceContext, sourceId: string): Promise<string | null>;
  /** Optional Stage-2 *batch* variant of `checkVisibilityAndGetName`, for N
   * ids in one round trip (AI Assistant Phase F). Same contract, just
   * plural: returns a Map of only the visible ids to their names — any id
   * missing from the map is treated as not-visible, same as a `null` return
   * from the single-id version. Implemented only for a handful of source
   * types most likely to have several candidates co-occur in one retrieval
   * (`tasks.rag.ts`, `projects.rag.ts`, `meetings.rag.ts`, `crm.rag.ts`) —
   * every handler without it keeps using the unchanged per-id sequential
   * path via `RetrievalService`'s own fallback, so this is purely
   * additive, never a breaking change to the other ~15 handlers. */
  checkVisibilityAndGetNames?(tx: PrismaTx, ctx: DataSourceContext, sourceIds: string[]): Promise<Map<string, string>>;
  /** Background-job-time extraction — full tenant scope, no
   * `DataSourceContext` (RBAC only ever applies at retrieval time, never at
   * embed time — same as the original Document-only job). Returns null when
   * there's nothing to embed (row gone/soft-deleted/blank content); the
   * processor marks the job done, not failed, in that case. */
  extractText(tx: PrismaTx, tenantId: string, sourceId: string): Promise<string | null>;
}

/**
 * AI RAG Phase C — one handler per embeddable `sourceType`, registered by
 * each feature module's own existing `OnModuleInit` registrar (the exact
 * `DataSourceRegistry`/`MutationRegistry`/`MetricRegistry` pattern every
 * module already follows). Lets `RetrievalService` (Stage-2 visibility) and
 * `EmbeddingJobProcessorService` (content extraction) dispatch to ~20
 * source types without either file importing a single feature module
 * directly — same decoupling `DataSourceRegistry` already gives the
 * `/api/data/:source` dispatcher.
 */
@Injectable()
export class RagSourceRegistry {
  private readonly handlers = new Map<string, RagSourceHandler>();

  register(handler: RagSourceHandler): void {
    if (this.handlers.has(handler.sourceType)) {
      throw new Error(`RAG source "${handler.sourceType}" is already registered`);
    }
    this.handlers.set(handler.sourceType, handler);
  }

  get(sourceType: string): RagSourceHandler | undefined {
    return this.handlers.get(sourceType);
  }
}
