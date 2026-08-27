import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { taskDetailDataSource, tasksCountDataSource, tasksListDataSource } from "./tasks.data-sources";
import { taskRagHandler } from "./tasks.rag";
import { taskCreateMutation, taskReassignMutation, taskUpdateStatusMutation, taskUpdateDueDateMutation, taskSubmitForReviewMutation, taskReviewMutation } from "./tasks.mutations";
import {
  tasksOpenCountMetric,
  tasksOverdueCountMetric,
  tasksCompletionRateMetric,
  tasksByPriorityMetric,
  tasksByProjectStatusMetric,
  tasksStatusFunnelMetric,
  tasksCompletionLeaderboardMetric,
  tasksAssigneeWorkloadMetric,
  tasksProductivityLeaderboardMetric,
  tasksOverloadedEmployeesMetric,
} from "./tasks.metrics";

/** Same registrar pattern as ProjectsModule — see its comment for why this
 * is deliberately not a bigger `ModuleDefinition` abstraction. */
@Injectable()
class TasksRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(tasksListDataSource);
    this.dataSources.register(tasksCountDataSource);
    this.dataSources.register(taskDetailDataSource);
    this.mutations.register(taskCreateMutation);
    this.mutations.register(taskUpdateStatusMutation);
    this.mutations.register(taskReassignMutation);
    this.mutations.register(taskUpdateDueDateMutation);
    this.mutations.register(taskSubmitForReviewMutation);
    this.mutations.register(taskReviewMutation);
    this.ragSources.register(taskRagHandler); // AI RAG Phase C
    this.metrics.register(tasksOpenCountMetric);
    this.metrics.register(tasksOverdueCountMetric);
    this.metrics.register(tasksCompletionRateMetric);
    this.metrics.register(tasksByPriorityMetric);
    this.metrics.register(tasksByProjectStatusMetric);
    this.metrics.register(tasksStatusFunnelMetric);
    this.metrics.register(tasksCompletionLeaderboardMetric);
    this.metrics.register(tasksAssigneeWorkloadMetric);
    this.metrics.register(tasksProductivityLeaderboardMetric);
    this.metrics.register(tasksOverloadedEmployeesMetric);
  }
}

@Module({
  providers: [TasksRegistrar],
})
export class TasksModule {}
