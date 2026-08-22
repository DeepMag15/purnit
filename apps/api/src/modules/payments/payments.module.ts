import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { paymentsListDataSource } from "./payments.data-sources";
import { paymentRecordMutation } from "./payments.mutations";
import { paymentsCollectedThisMonthMetric } from "./payments.metrics";
import { paymentRagHandler } from "./payments.rag";

/** Finance Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class PaymentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(paymentsListDataSource);
    this.mutations.register(paymentRecordMutation);
    this.metrics.register(paymentsCollectedThisMonthMetric);
    this.ragSources.register(paymentRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [PaymentsRegistrar],
})
export class PaymentsModule {}
