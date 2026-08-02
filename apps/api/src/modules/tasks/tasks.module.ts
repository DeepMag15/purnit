import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { tasksCountDataSource, tasksListDataSource } from "./tasks.data-sources";
import { taskCreateMutation, taskReassignMutation, taskUpdateStatusMutation } from "./tasks.mutations";

/** Same registrar pattern as ProjectsModule — see its comment for why this
 * is deliberately not a bigger `ModuleDefinition` abstraction. */
@Injectable()
class TasksRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(tasksListDataSource);
    this.dataSources.register(tasksCountDataSource);
    this.mutations.register(taskCreateMutation);
    this.mutations.register(taskUpdateStatusMutation);
    this.mutations.register(taskReassignMutation);
  }
}

@Module({
  providers: [TasksRegistrar],
})
export class TasksModule {}
