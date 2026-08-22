import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { suppliersListDataSource, supplierDetailDataSource, suppliersCapabilitiesDataSource } from "./suppliers.data-sources";
import { supplierCreateMutation, supplierUpdateStatusMutation } from "./suppliers.mutations";
import { suppliersTotalCountMetric } from "./suppliers.metrics";
import { supplierRagHandler } from "./suppliers.rag";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class SuppliersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(suppliersListDataSource);
    this.dataSources.register(supplierDetailDataSource);
    this.dataSources.register(suppliersCapabilitiesDataSource);
    this.mutations.register(supplierCreateMutation);
    this.mutations.register(supplierUpdateStatusMutation);
    this.metrics.register(suppliersTotalCountMetric);
    this.ragSources.register(supplierRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [SuppliersRegistrar],
})
export class SuppliersModule {}
