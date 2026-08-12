import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { suppliersListDataSource, supplierDetailDataSource } from "./suppliers.data-sources";
import { supplierCreateMutation, supplierUpdateStatusMutation } from "./suppliers.mutations";
import { suppliersTotalCountMetric } from "./suppliers.metrics";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class SuppliersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(suppliersListDataSource);
    this.dataSources.register(supplierDetailDataSource);
    this.mutations.register(supplierCreateMutation);
    this.mutations.register(supplierUpdateStatusMutation);
    this.metrics.register(suppliersTotalCountMetric);
  }
}

@Module({
  providers: [SuppliersRegistrar],
})
export class SuppliersModule {}
