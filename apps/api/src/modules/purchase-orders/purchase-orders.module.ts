import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import {
  purchaseOrdersListDataSource,
  purchaseOrderDetailDataSource,
  purchaseOrdersCapabilitiesDataSource,
} from "./purchase-orders.data-sources";
import { purchaseOrderCreateMutation, purchaseOrderUpdateStatusMutation, purchaseOrderReceiveMutation } from "./purchase-orders.mutations";
import { purchaseOrdersOpenCountMetric, purchaseOrdersTotalOpenValueMetric } from "./purchase-orders.metrics";
import { purchaseOrderRagHandler } from "./purchase-orders.rag";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class PurchaseOrdersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(purchaseOrdersListDataSource);
    this.dataSources.register(purchaseOrderDetailDataSource);
    this.dataSources.register(purchaseOrdersCapabilitiesDataSource);
    this.mutations.register(purchaseOrderCreateMutation);
    this.mutations.register(purchaseOrderUpdateStatusMutation);
    this.mutations.register(purchaseOrderReceiveMutation);
    this.metrics.register(purchaseOrdersOpenCountMetric);
    this.metrics.register(purchaseOrdersTotalOpenValueMetric);
    this.ragSources.register(purchaseOrderRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [PurchaseOrdersRegistrar],
})
export class PurchaseOrdersModule {}
