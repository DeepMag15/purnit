import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { invoicesListDataSource, invoiceDetailDataSource } from "./invoices.data-sources";
import { invoiceCreateMutation, invoiceUpdateStatusMutation } from "./invoices.mutations";
import { invoicesOverdueCountMetric, invoicesTotalOutstandingMetric } from "./invoices.metrics";

/** Finance Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class InvoicesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(invoicesListDataSource);
    this.dataSources.register(invoiceDetailDataSource);
    this.mutations.register(invoiceCreateMutation);
    this.mutations.register(invoiceUpdateStatusMutation);
    this.metrics.register(invoicesOverdueCountMetric);
    this.metrics.register(invoicesTotalOutstandingMetric);
  }
}

@Module({
  providers: [InvoicesRegistrar],
})
export class InvoicesModule {}
