import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { workOrdersListDataSource, workOrderDetailDataSource } from "./work-orders.data-sources";
import { workOrderCreateMutation, workOrderUpdateStatusMutation, workOrderCompleteMutation } from "./work-orders.mutations";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class WorkOrdersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(workOrdersListDataSource);
    this.dataSources.register(workOrderDetailDataSource);
    this.mutations.register(workOrderCreateMutation);
    this.mutations.register(workOrderUpdateStatusMutation);
    this.mutations.register(workOrderCompleteMutation);
  }
}

@Module({
  providers: [WorkOrdersRegistrar],
})
export class WorkOrdersModule {}
