import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { inventoryItemsListDataSource, inventoryItemDetailDataSource } from "./inventory-items.data-sources";
import { inventoryItemCreateMutation, inventoryItemUpdateMutation, inventoryItemAdjustStockMutation } from "./inventory-items.mutations";
import { inventoryItemsLowStockCountMetric, inventoryItemsTotalValueMetric, inventoryItemsTypeBreakdownMetric } from "./inventory-items.metrics";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class InventoryItemsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(inventoryItemsListDataSource);
    this.dataSources.register(inventoryItemDetailDataSource);
    this.mutations.register(inventoryItemCreateMutation);
    this.mutations.register(inventoryItemUpdateMutation);
    this.mutations.register(inventoryItemAdjustStockMutation);
    this.metrics.register(inventoryItemsLowStockCountMetric);
    this.metrics.register(inventoryItemsTotalValueMetric);
    this.metrics.register(inventoryItemsTypeBreakdownMetric);
  }
}

@Module({
  providers: [InventoryItemsRegistrar],
})
export class InventoryItemsModule {}
