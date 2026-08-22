import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { assignmentsListDataSource } from "./assignments.data-sources";
import { assignmentCreateMutation, assignmentUpdateMutation } from "./assignments.mutations";
import { assignmentsDueSoonCountMetric } from "./assignments.metrics";
import { assignmentRagHandler } from "./assignments.rag";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class AssignmentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(assignmentsListDataSource);
    this.mutations.register(assignmentCreateMutation);
    this.mutations.register(assignmentUpdateMutation);
    this.metrics.register(assignmentsDueSoonCountMetric);
    this.ragSources.register(assignmentRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [AssignmentsRegistrar],
})
export class AssignmentsModule {}
