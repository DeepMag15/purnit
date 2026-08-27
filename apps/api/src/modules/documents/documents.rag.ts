import type { RagSourceHandler } from "../../ai/retrieval/rag-source-registry.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { extractDocumentText } from "../../ai/embeddings/document-text-extraction";
import { assertProjectVisible } from "./documents.data-sources";

/** AI RAG Phase C — Documents' own `RagSourceHandler`, converted unchanged
 * from what used to be inlined directly in `retrieval.service.ts`
 * (visibility) and `embedding-job-processor.service.ts` (extraction) before
 * `RagSourceRegistry` existed. A factory, not a plain constant, since
 * extraction needs `SupabaseAdminService` to download the file's bytes —
 * same factory-with-injected-service shape as `createDocumentCreateUploadUrlMutation`. */
export function createDocumentRagHandler(supabaseAdmin: SupabaseAdminService): RagSourceHandler {
  return {
    sourceType: "document",
    async checkVisibilityAndGetName(tx, ctx, sourceId) {
      const document = await tx.document.findFirst({ where: { id: sourceId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!document) return null;
      await assertProjectVisible(tx, ctx, document.projectId);
      return document.name;
    },
    async extractText(tx, tenantId, sourceId) {
      const document = await tx.document.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
      if (!document) return null;
      const bytes = await supabaseAdmin.downloadDocumentBytes(document.storagePath);
      return extractDocumentText(bytes, document.mimeType);
    },
  };
}
