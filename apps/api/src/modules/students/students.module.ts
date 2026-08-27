import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { studentsListDataSource, studentDetailDataSource, studentsCapabilitiesDataSource } from "./students.data-sources";
import { studentRegisterMutation, studentUpdateStatusMutation } from "./students.mutations";
import { studentsTotalCountMetric, studentsStatusBreakdownMetric } from "./students.metrics";
import { studentRagHandler } from "./students.rag";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class StudentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(studentsListDataSource);
    this.dataSources.register(studentDetailDataSource);
    this.dataSources.register(studentsCapabilitiesDataSource);
    this.mutations.register(studentRegisterMutation);
    this.mutations.register(studentUpdateStatusMutation);
    this.metrics.register(studentsTotalCountMetric);
    this.metrics.register(studentsStatusBreakdownMetric);
    this.ragSources.register(studentRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [StudentsRegistrar],
})
export class StudentsModule {}
