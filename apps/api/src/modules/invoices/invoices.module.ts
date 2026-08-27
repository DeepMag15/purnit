import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { invoicesListDataSource, invoiceDetailDataSource, invoicesCapabilitiesDataSource } from "./invoices.data-sources";
import { invoiceCreateMutation, invoiceUpdateStatusMutation } from "./invoices.mutations";
import { invoicesOverdueCountMetric, invoicesTotalOutstandingMetric } from "./invoices.metrics";
import { invoiceRagHandler } from "./invoices.rag";

/** Finance Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class InvoicesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(invoicesListDataSource);
    this.dataSources.register(invoiceDetailDataSource);
    this.dataSources.register(invoicesCapabilitiesDataSource);
    this.mutations.register(invoiceCreateMutation);
    this.mutations.register(invoiceUpdateStatusMutation);
    this.metrics.register(invoicesOverdueCountMetric);
    this.metrics.register(invoicesTotalOutstandingMetric);
    this.ragSources.register(invoiceRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [InvoicesRegistrar],
})
export class InvoicesModule {}
