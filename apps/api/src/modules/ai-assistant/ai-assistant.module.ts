import { Injectable, Module, type OnApplicationBootstrap, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { AiProviderService } from "../../ai/provider/ai-provider.service";
import { EmbeddingProviderService } from "../../ai/embeddings/embedding-provider.service";
import { RetrievalService } from "../../ai/retrieval/retrieval.service";
import { PermissionResolverService } from "../../rbac/permission-resolver.service";
import { AI_TOOL_ALLOWLIST } from "../../ai/tool-calling/ai-tool-allowlist";
import { aiConversationsListDataSource, aiConversationMessagesDataSource, aiProviderSettingsDataSource } from "./ai-assistant.data-sources";
import { aiConversationCreateMutation, aiConversationArchiveMutation, createAiMessageSendMutation } from "./ai-assistant.mutations";
import { createAiToolCallConfirmMutation, createAiToolCallReplyMutation } from "./ai-tool-call.mutations";
import { aiUsageSummaryMetric } from "./ai-assistant.metrics";

/** Same registrar pattern as every other module — see meetings.module.ts.
 * `AiProviderService`/`EmbeddingProviderService`/`RetrievalService` are
 * exported `@Global()` by `AiModule` (see ai/ai.module.ts) so no explicit
 * import is needed to inject them here, same precedent as
 * `TenantPrismaService` via `TenancyModule`. */
@Injectable()
class AiAssistantRegistrar implements OnModuleInit, OnApplicationBootstrap {
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
    this.dataSources.register(aiProviderSettingsDataSource);
    this.mutations.register(aiConversationCreateMutation);
    this.mutations.register(aiConversationArchiveMutation);
    this.mutations.register(
      createAiMessageSendMutation(
        this.aiProvider,
        this.tenantPrisma,
        this.embeddingProvider,
        this.retrievalService,
        this.permissionResolver,
        this.mutations,
      ),
    );
    this.mutations.register(createAiToolCallConfirmMutation(this.tenantPrisma, this.mutations));
    this.mutations.register(createAiToolCallReplyMutation(this.aiProvider, this.tenantPrisma));
    this.metrics.register(aiUsageSummaryMetric);
  }

  // Phase D — fails fast, at boot, on a typo'd or since-removed
  // AI_TOOL_ALLOWLIST entry, rather than silently offering a broken tool at
  // first use. Deliberately OnApplicationBootstrap, not OnModuleInit:
  // AiAssistantModule initializes before several modules several allowlist
  // entries live in (e.g. PatientsModule, ClientsModule, InvoicesModule,
  // SuppliersModule — see app.module.ts's import order), so their mutations
  // aren't registered yet at this module's own onModuleInit() time.
  // OnApplicationBootstrap is guaranteed to run only after every module's
  // onModuleInit() has completed. Deliberately throws synchronously and
  // crashes boot — unlike AiProviderService's "never throw at boot, defer to
  // first use" precedent, which exists specifically for an *optional*
  // missing third-party key; a typo'd allowlist entry is a pure code/deploy
  // defect with no such excuse.
  onApplicationBootstrap() {
    for (const entry of AI_TOOL_ALLOWLIST) {
      if (!this.mutations.get(entry.mutationName)) {
        throw new Error(`AI_TOOL_ALLOWLIST entry "${entry.mutationName}" does not resolve to a registered mutation`);
      }
    }
  }
}

@Module({
  providers: [AiAssistantRegistrar],
})
export class AiAssistantModule {}
