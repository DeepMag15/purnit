import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { bomLinesListDataSource } from "./bom-lines.data-sources";
import { bomLineCreateMutation, bomLineUpdateMutation, bomLineDeleteMutation } from "./bom-lines.mutations";
import { bomLineRagHandler } from "./bom-lines.rag";

/** Manufacturing Domain, Phase A. Same registrar pattern as every other
 * module — see clients.module.ts. */
@Injectable()
class BomLinesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(bomLinesListDataSource);
    this.mutations.register(bomLineCreateMutation);
    this.mutations.register(bomLineUpdateMutation);
    this.mutations.register(bomLineDeleteMutation);
    this.ragSources.register(bomLineRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [BomLinesRegistrar],
})
export class BomLinesModule {}
