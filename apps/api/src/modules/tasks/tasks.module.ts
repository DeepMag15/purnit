import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { tasksCountDataSource, tasksListDataSource } from "./tasks.data-sources";
import { taskCreateMutation, taskReassignMutation, taskUpdateStatusMutation } from "./tasks.mutations";
import {
  tasksOpenCountMetric,
  tasksOverdueCountMetric,
  tasksCompletionRateMetric,
  tasksByPriorityMetric,
  tasksByProjectStatusMetric,
  tasksStatusFunnelMetric,
  tasksCompletionLeaderboardMetric,
  tasksAssigneeWorkloadMetric,
} from "./tasks.metrics";

/** Same registrar pattern as ProjectsModule — see its comment for why this
 * is deliberately not a bigger `ModuleDefinition` abstraction. */
@Injectable()
class TasksRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(tasksListDataSource);
    this.dataSources.register(tasksCountDataSource);
    this.mutations.register(taskCreateMutation);
    this.mutations.register(taskUpdateStatusMutation);
    this.mutations.register(taskReassignMutation);
    this.metrics.register(tasksOpenCountMetric);
    this.metrics.register(tasksOverdueCountMetric);
    this.metrics.register(tasksCompletionRateMetric);
    this.metrics.register(tasksByPriorityMetric);
    this.metrics.register(tasksByProjectStatusMetric);
    this.metrics.register(tasksStatusFunnelMetric);
    this.metrics.register(tasksCompletionLeaderboardMetric);
    this.metrics.register(tasksAssigneeWorkloadMetric);
  }
}

@Module({
  providers: [TasksRegistrar],
})
export class TasksModule {}
