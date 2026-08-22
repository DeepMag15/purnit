import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { coursesListDataSource, courseDetailDataSource, coursesTeacherOptionsDataSource, coursesCapabilitiesDataSource } from "./courses.data-sources";
import { courseCreateMutation, courseUpdateStatusMutation, courseAssignTeacherMutation } from "./courses.mutations";
import { coursesActiveCountMetric, teachersActiveCountMetric } from "./courses.metrics";
import { courseRagHandler } from "./courses.rag";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class CoursesRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(coursesListDataSource);
    this.dataSources.register(courseDetailDataSource);
    this.dataSources.register(coursesTeacherOptionsDataSource);
    this.dataSources.register(coursesCapabilitiesDataSource);
    this.mutations.register(courseCreateMutation);
    this.mutations.register(courseUpdateStatusMutation);
    this.mutations.register(courseAssignTeacherMutation);
    this.metrics.register(coursesActiveCountMetric);
    this.metrics.register(teachersActiveCountMetric);
    this.ragSources.register(courseRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [CoursesRegistrar],
})
export class CoursesModule {}
