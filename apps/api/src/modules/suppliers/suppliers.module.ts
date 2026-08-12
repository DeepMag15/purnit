import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { suppliersListDataSource, supplierDetailDataSource } from "./suppliers.data-sources";
import { supplierCreateMutation, supplierUpdateStatusMutation } from "./suppliers.mutations";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class SuppliersRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(suppliersListDataSource);
    this.dataSources.register(supplierDetailDataSource);
    this.mutations.register(supplierCreateMutation);
    this.mutations.register(supplierUpdateStatusMutation);
  }
}

@Module({
  providers: [SuppliersRegistrar],
})
export class SuppliersModule {}
