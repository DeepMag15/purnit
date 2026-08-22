import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { enrollmentsListDataSource } from "./enrollments.data-sources";
import { enrollmentEnrollMutation, enrollmentUpdateStatusMutation, enrollmentRecordFinalGradeMutation } from "./enrollments.mutations";
import { enrollmentsActiveCountMetric } from "./enrollments.metrics";
import { enrollmentRagHandler } from "./enrollments.rag";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class EnrollmentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(enrollmentsListDataSource);
    this.mutations.register(enrollmentEnrollMutation);
    this.mutations.register(enrollmentUpdateStatusMutation);
    this.mutations.register(enrollmentRecordFinalGradeMutation);
    this.metrics.register(enrollmentsActiveCountMetric);
    this.ragSources.register(enrollmentRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [EnrollmentsRegistrar],
})
export class EnrollmentsModule {}
