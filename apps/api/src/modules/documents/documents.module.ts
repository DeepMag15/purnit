import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { AuthModule } from "../../auth/auth.module";
import { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { documentsListDataSource, documentDetailDataSource } from "./documents.data-sources";
import {
  createDocumentCreateUploadUrlMutation,
  documentCreateMutation,
  documentUpdateMutation,
  createDocumentCreateReplaceUploadUrlMutation,
  documentFinalizeReplaceMutation,
  documentSetApprovalStatusMutation,
  documentDeleteMutation,
  createDocumentGetFileUrlMutation,
} from "./documents.mutations";

/** Same registrar pattern as every other module — see meetings.module.ts.
 * `SupabaseAdminService` isn't global, so `AuthModule` is imported below,
 * same precedent as `settings.module.ts`. */
@Injectable()
class DocumentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
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
    this.mutations.register(documentSetApprovalStatusMutation);
    this.mutations.register(documentDeleteMutation);
    this.mutations.register(createDocumentGetFileUrlMutation(this.supabaseAdmin));
  }
}

@Module({
  imports: [AuthModule],
  providers: [DocumentsRegistrar],
})
export class DocumentsModule {}
