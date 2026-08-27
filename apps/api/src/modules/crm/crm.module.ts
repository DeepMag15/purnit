import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { contactsListDataSource, contactDetailDataSource, dealsListDataSource, crmCapabilitiesDataSource } from "./crm.data-sources";
import { contactRagHandler, dealRagHandler } from "./crm.rag";
import { contactCreateMutation, contactUpdateMutation, dealCreateMutation, dealUpdateMutation, dealUpdateStageMutation } from "./crm.mutations";

/** Same registrar pattern as every other module — see leave.module.ts. */
@Injectable()
class CrmRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(contactsListDataSource);
    this.dataSources.register(contactDetailDataSource);
    this.dataSources.register(dealsListDataSource);
    this.dataSources.register(crmCapabilitiesDataSource);
    this.mutations.register(contactCreateMutation);
    this.mutations.register(contactUpdateMutation);
    this.mutations.register(dealCreateMutation);
    this.mutations.register(dealUpdateMutation);
    this.mutations.register(dealUpdateStageMutation);
    this.ragSources.register(contactRagHandler); // AI RAG Phase C
    this.ragSources.register(dealRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [CrmRegistrar],
})
export class CrmModule {}
