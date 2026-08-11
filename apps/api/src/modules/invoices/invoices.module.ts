import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { invoicesListDataSource, invoiceDetailDataSource } from "./invoices.data-sources";
import { invoiceCreateMutation, invoiceUpdateStatusMutation } from "./invoices.mutations";

/** Finance Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class InvoicesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(invoicesListDataSource);
    this.dataSources.register(invoiceDetailDataSource);
    this.mutations.register(invoiceCreateMutation);
    this.mutations.register(invoiceUpdateStatusMutation);
  }
}

@Module({
  providers: [InvoicesRegistrar],
})
export class InvoicesModule {}
