import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import {
  inventoryItemsListDataSource,
  inventoryItemDetailDataSource,
  inventoryItemsCapabilitiesDataSource,
} from "./inventory-items.data-sources";
import { inventoryItemCreateMutation, inventoryItemUpdateMutation, inventoryItemAdjustStockMutation } from "./inventory-items.mutations";
import { inventoryItemsLowStockCountMetric, inventoryItemsTotalValueMetric, inventoryItemsTypeBreakdownMetric } from "./inventory-items.metrics";
import { inventoryItemRagHandler } from "./inventory-items.rag";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class InventoryItemsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(inventoryItemsListDataSource);
    this.dataSources.register(inventoryItemDetailDataSource);
    this.dataSources.register(inventoryItemsCapabilitiesDataSource);
    this.mutations.register(inventoryItemCreateMutation);
    this.mutations.register(inventoryItemUpdateMutation);
    this.mutations.register(inventoryItemAdjustStockMutation);
    this.metrics.register(inventoryItemsLowStockCountMetric);
    this.metrics.register(inventoryItemsTotalValueMetric);
    this.metrics.register(inventoryItemsTypeBreakdownMetric);
    this.ragSources.register(inventoryItemRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [InventoryItemsRegistrar],
})
export class InventoryItemsModule {}
