import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { purchaseOrdersListDataSource, purchaseOrderDetailDataSource } from "./purchase-orders.data-sources";
import { purchaseOrderCreateMutation, purchaseOrderUpdateStatusMutation, purchaseOrderReceiveMutation } from "./purchase-orders.mutations";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class PurchaseOrdersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(purchaseOrdersListDataSource);
    this.dataSources.register(purchaseOrderDetailDataSource);
    this.mutations.register(purchaseOrderCreateMutation);
    this.mutations.register(purchaseOrderUpdateStatusMutation);
    this.mutations.register(purchaseOrderReceiveMutation);
  }
}

@Module({
  providers: [PurchaseOrdersRegistrar],
})
export class PurchaseOrdersModule {}
