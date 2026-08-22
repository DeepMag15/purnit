import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import {
  clientsListDataSource,
  clientDetailDataSource,
  clientsAccountManagerOptionsDataSource,
  clientsCapabilitiesDataSource,
} from "./clients.data-sources";
import { clientCreateMutation, clientUpdateStatusMutation, clientAssignAccountManagerMutation } from "./clients.mutations";
import { clientsTotalCountMetric, clientsStatusBreakdownMetric } from "./clients.metrics";
import { clientRagHandler } from "./clients.rag";

/** Finance Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class ClientsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(clientsListDataSource);
    this.dataSources.register(clientDetailDataSource);
    this.dataSources.register(clientsAccountManagerOptionsDataSource);
    this.dataSources.register(clientsCapabilitiesDataSource);
    this.mutations.register(clientCreateMutation);
    this.mutations.register(clientUpdateStatusMutation);
    this.mutations.register(clientAssignAccountManagerMutation);
    this.metrics.register(clientsTotalCountMetric);
    this.metrics.register(clientsStatusBreakdownMetric);
    this.ragSources.register(clientRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [ClientsRegistrar],
})
export class ClientsModule {}
