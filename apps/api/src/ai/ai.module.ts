import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiProviderService } from "./provider/ai-provider.service";
import { EmbeddingProviderService } from "./embeddings/embedding-provider.service";
import { EmbeddingJobProcessorService } from "./embeddings/embedding-job-processor.service";
import { RetrievalService } from "./retrieval/retrieval.service";

/** Platform infra, same treatment as TenancyModule/RbacModule — @Global()
 * so any business module can inject AiProviderService without an explicit
 * import, and no business module ever imports a vendor SDK directly.
 * `AuthModule` is imported (not global) for `SupabaseAdminService`, needed
 * by `EmbeddingJobProcessorService` to download document bytes — same
 * precedent as `documents.module.ts`. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [AiProviderService, EmbeddingProviderService, EmbeddingJobProcessorService, RetrievalService],
  exports: [AiProviderService, EmbeddingProviderService, RetrievalService],
})
export class AiModule {}
