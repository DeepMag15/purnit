import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { AiProviderService } from "../../ai/provider/ai-provider.service";
import { EmbeddingProviderService } from "../../ai/embeddings/embedding-provider.service";
import { RetrievalService } from "../../ai/retrieval/retrieval.service";
import { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { aiConversationsListDataSource, aiConversationMessagesDataSource } from "./ai-assistant.data-sources";
import { aiConversationCreateMutation, aiConversationArchiveMutation, createAiMessageSendMutation } from "./ai-assistant.mutations";
import { aiUsageSummaryMetric } from "./ai-assistant.metrics";

/** Same registrar pattern as every other module — see meetings.module.ts.
 * `AiProviderService`/`EmbeddingProviderService`/`RetrievalService` are
 * exported `@Global()` by `AiModule` (see ai/ai.module.ts) so no explicit
 * import is needed to inject them here, same precedent as
 * `TenantPrismaService` via `TenancyModule`. */
@Injectable()
class AiAssistantRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly aiProvider: AiProviderService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly embeddingProvider: EmbeddingProviderService,
    private readonly retrievalService: RetrievalService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(aiConversationsListDataSource);
    this.dataSources.register(aiConversationMessagesDataSource);
    this.mutations.register(aiConversationCreateMutation);
    this.mutations.register(aiConversationArchiveMutation);
    this.mutations.register(
      createAiMessageSendMutation(this.aiProvider, this.tenantPrisma, this.embeddingProvider, this.retrievalService, this.permissionResolver),
    );
    this.metrics.register(aiUsageSummaryMetric);
  }
}

@Module({
  providers: [AiAssistantRegistrar],
})
export class AiAssistantModule {}
