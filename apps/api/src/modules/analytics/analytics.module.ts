import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { createAnalyticsDashboardDataSource, createAnalyticsTrendDataSource } from "./analytics.data-sources";
import { AnalyticsSnapshotProcessorService } from "./analytics-snapshot-processor.service";

/** Same registrar pattern as every other module — see attendance.module.ts.
 * No mutations — Analytics is read-only. */
@Injectable()
class AnalyticsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly metricRegistry: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(createAnalyticsDashboardDataSource(this.metricRegistry));
    this.dataSources.register(createAnalyticsTrendDataSource(this.metricRegistry));
  }
}

@Module({
  providers: [AnalyticsRegistrar, AnalyticsSnapshotProcessorService],
})
export class AnalyticsModule {}
