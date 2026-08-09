import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { createAnalyticsDashboardDataSource, createAnalyticsTrendDataSource } from "./analytics.data-sources";
import { AnalyticsSnapshotProcessorService } from "./analytics-snapshot-processor.service";
import { dashboardLayoutSaveMutation, dashboardLayoutResetMutation, dashboardLayoutSaveAsTemplateMutation } from "./dashboard-layout.mutations";

/** Same registrar pattern as every other module — see attendance.module.ts.
 * Phase E (Dashboard Customization) added the first Analytics mutations —
 * the module was read-only through Phase D. */
@Injectable()
class AnalyticsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metricRegistry: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(createAnalyticsDashboardDataSource(this.metricRegistry));
    this.dataSources.register(createAnalyticsTrendDataSource(this.metricRegistry));
    this.mutations.register(dashboardLayoutSaveMutation);
    this.mutations.register(dashboardLayoutResetMutation);
    this.mutations.register(dashboardLayoutSaveAsTemplateMutation);
  }
}

@Module({
  providers: [AnalyticsRegistrar, AnalyticsSnapshotProcessorService],
})
export class AnalyticsModule {}
