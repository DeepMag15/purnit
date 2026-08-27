import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { AuthModule } from "../../auth/auth.module";
import { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { documentsListDataSource, documentDetailDataSource } from "./documents.data-sources";
import {
  createDocumentCreateUploadUrlMutation,
  documentCreateMutation,
  documentUpdateMutation,
  createDocumentCreateReplaceUploadUrlMutation,
  documentFinalizeReplaceMutation,
  documentRequestApprovalMutation,
  documentSetApprovalStatusMutation,
  documentDeleteMutation,
  createDocumentGetFileUrlMutation,
} from "./documents.mutations";
import { documentsPendingApprovalsMetric } from "./documents.metrics";
import { createDocumentRagHandler } from "./documents.rag";

/** Same registrar pattern as every other module — see meetings.module.ts.
 * `SupabaseAdminService` isn't global, so `AuthModule` is imported below,
 * same precedent as `settings.module.ts`. Phase F (Analytics) added this
 * module's first `MetricRegistry` presence — `MetricRegistry` is `@Global()`
 * (metrics.module.ts), same zero-import-wiring precedent every other
 * module's registrar already relies on. */
@Injectable()
class DocumentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  onModuleInit() {
    this.dataSources.register(documentsListDataSource);
    this.dataSources.register(documentDetailDataSource);
    this.mutations.register(createDocumentCreateUploadUrlMutation(this.supabaseAdmin));
    this.mutations.register(documentCreateMutation);
    this.mutations.register(documentUpdateMutation);
    this.mutations.register(createDocumentCreateReplaceUploadUrlMutation(this.supabaseAdmin));
    this.mutations.register(documentFinalizeReplaceMutation);
    this.mutations.register(documentRequestApprovalMutation);
    this.mutations.register(documentSetApprovalStatusMutation);
    this.mutations.register(documentDeleteMutation);
    this.mutations.register(createDocumentGetFileUrlMutation(this.supabaseAdmin));
    this.metrics.register(documentsPendingApprovalsMetric);
    // AI RAG Phase C — converted from what used to be inlined directly in
    // retrieval.service.ts/embedding-job-processor.service.ts.
    this.ragSources.register(createDocumentRagHandler(this.supabaseAdmin));
  }
}

@Module({
  imports: [AuthModule],
  providers: [DocumentsRegistrar],
})
export class DocumentsModule {}
