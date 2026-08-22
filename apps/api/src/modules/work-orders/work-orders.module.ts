import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { workOrdersListDataSource, workOrderDetailDataSource, workOrdersCapabilitiesDataSource } from "./work-orders.data-sources";
import { workOrderCreateMutation, workOrderUpdateStatusMutation, workOrderCompleteMutation } from "./work-orders.mutations";
import { workOrdersInProgressCountMetric } from "./work-orders.metrics";
import { workOrderRagHandler } from "./work-orders.rag";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class WorkOrdersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(workOrdersListDataSource);
    this.dataSources.register(workOrderDetailDataSource);
    this.dataSources.register(workOrdersCapabilitiesDataSource);
    this.mutations.register(workOrderCreateMutation);
    this.mutations.register(workOrderUpdateStatusMutation);
    this.mutations.register(workOrderCompleteMutation);
    this.metrics.register(workOrdersInProgressCountMetric);
    this.ragSources.register(workOrderRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [WorkOrdersRegistrar],
})
export class WorkOrdersModule {}
