import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { createAnalyticsDashboardDataSource, createAnalyticsTrendDataSource } from "./analytics.data-sources";
import { AnalyticsSnapshotProcessorService } from "./analytics-snapshot-processor.service";
import { dashboardLayoutSaveMutation, dashboardLayoutResetMutation, dashboardLayoutSaveAsTemplateMutation } from "./dashboard-layout.mutations";
import { dashboardLayoutGetDataSource } from "./dashboard-layout.data-sources";
import { employeeProductivityScoreMetric } from "./analytics.composites";

/** Same registrar pattern as every other module — see attendance.module.ts.
 * Phase E (Dashboard Customization) added the first Analytics mutations —
 * the module was read-only through Phase D. Phase F added the first
 * Analytics-owned metric (every metric before this belonged to the module it
 * describes) — a cross-module composite has no other natural home, and
 * registering it here (rather than inside e.g. TasksRegistrar) is safe
 * regardless of module-init order, since its ingredient keys are resolved
 * lazily at request time (see analytics.composites.ts). */
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
    this.dataSources.register(dashboardLayoutGetDataSource);
    this.mutations.register(dashboardLayoutSaveMutation);
    this.mutations.register(dashboardLayoutResetMutation);
    this.mutations.register(dashboardLayoutSaveAsTemplateMutation);
    this.metricRegistry.register(employeeProductivityScoreMetric);
  }
}

@Module({
  providers: [AnalyticsRegistrar, AnalyticsSnapshotProcessorService],
})
export class AnalyticsModule {}
