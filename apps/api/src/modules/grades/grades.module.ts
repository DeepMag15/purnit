import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { gradesListDataSource } from "./grades.data-sources";
import { gradeRecordMutation, gradeUpdateMutation } from "./grades.mutations";
import { averageGradePercentMetric, gradesRecordedCountMetric } from "./grades.metrics";
import { gradeRagHandler } from "./grades.rag";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class GradesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(gradesListDataSource);
    this.mutations.register(gradeRecordMutation);
    this.mutations.register(gradeUpdateMutation);
    this.metrics.register(averageGradePercentMetric);
    this.metrics.register(gradesRecordedCountMetric);
    this.ragSources.register(gradeRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [GradesRegistrar],
})
export class GradesModule {}
