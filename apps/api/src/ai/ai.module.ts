import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiProviderService } from "./provider/ai-provider.service";
import { EmbeddingProviderService } from "./embeddings/embedding-provider.service";
import { EmbeddingJobProcessorService } from "./embeddings/embedding-job-processor.service";
import { RetrievalService } from "./retrieval/retrieval.service";
import { RagSourceRegistry } from "./retrieval/rag-source-registry.service";

/** Platform infra, same treatment as TenancyModule/RbacModule — @Global()
 * so any business module can inject AiProviderService without an explicit
 * import, and no business module ever imports a vendor SDK directly.
 * `AuthModule` is imported (not global) for `SupabaseAdminService`, needed
 * by `EmbeddingJobProcessorService` to download document bytes — same
 * precedent as `documents.module.ts`. AI RAG Phase C — `RagSourceRegistry`
 * exported here too (not a separate module) since every business module
 * already needs zero-import access to it, exactly like `RetrievalService`. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [AiProviderService, EmbeddingProviderService, EmbeddingJobProcessorService, RetrievalService, RagSourceRegistry],
  exports: [AiProviderService, EmbeddingProviderService, RetrievalService, RagSourceRegistry],
})
export class AiModule {}
