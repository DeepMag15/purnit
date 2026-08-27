import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { appointmentsListDataSource, appointmentsCapabilitiesDataSource } from "./appointments.data-sources";
import { appointmentCreateMutation, appointmentUpdateStatusMutation } from "./appointments.mutations";
import { appointmentsTodayCountMetric, appointmentsCompletedCountMetric } from "./appointments.metrics";
import { appointmentRagHandler } from "./appointments.rag";

/** Healthcare Domain, Phase A. Same registrar pattern as every other
 * module — see attendance.module.ts. */
@Injectable()
class AppointmentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(appointmentsListDataSource);
    this.dataSources.register(appointmentsCapabilitiesDataSource);
    this.mutations.register(appointmentCreateMutation);
    this.mutations.register(appointmentUpdateStatusMutation);
    this.metrics.register(appointmentsTodayCountMetric);
    this.metrics.register(appointmentsCompletedCountMetric);
    this.ragSources.register(appointmentRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [AppointmentsRegistrar],
})
export class AppointmentsModule {}
