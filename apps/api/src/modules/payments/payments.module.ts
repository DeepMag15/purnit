import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { paymentsListDataSource } from "./payments.data-sources";
import { paymentRecordMutation } from "./payments.mutations";
import { paymentsCollectedThisMonthMetric } from "./payments.metrics";

/** Finance Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class PaymentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(paymentsListDataSource);
    this.mutations.register(paymentRecordMutation);
    this.metrics.register(paymentsCollectedThisMonthMetric);
  }
}

@Module({
  providers: [PaymentsRegistrar],
})
export class PaymentsModule {}
