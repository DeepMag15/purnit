import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { assignmentsListDataSource } from "./assignments.data-sources";
import { assignmentCreateMutation, assignmentUpdateMutation } from "./assignments.mutations";

/** Education Domain, Phase A. Same registrar pattern as every other module —
 * see patients.module.ts. */
@Injectable()
class AssignmentsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(assignmentsListDataSource);
    this.mutations.register(assignmentCreateMutation);
    this.mutations.register(assignmentUpdateMutation);
  }
}

@Module({
  providers: [AssignmentsRegistrar],
})
export class AssignmentsModule {}
