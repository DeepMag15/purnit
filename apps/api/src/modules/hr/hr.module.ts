import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { departmentsListDataSource, teamsListDataSource, departmentTypesListDataSource } from "./hr.data-sources";
import {
  departmentCreateMutation,
  departmentUpdateMutation,
  departmentSetArchivedMutation,
  departmentDeleteMutation,
  departmentAssignHeadMutation,
  teamCreateMutation,
  teamUpdateMutation,
  teamMoveToDepartmentMutation,
  teamSetArchivedMutation,
  teamDeleteMutation,
  teamAssignManagerMutation,
} from "./hr.mutations";

/** Same registrar pattern as every prior module — see projects.module.ts. */
@Injectable()
class HrRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(departmentsListDataSource);
    this.dataSources.register(teamsListDataSource);
    this.dataSources.register(departmentTypesListDataSource);
    this.mutations.register(departmentCreateMutation);
    this.mutations.register(departmentUpdateMutation);
    this.mutations.register(departmentSetArchivedMutation);
    this.mutations.register(departmentDeleteMutation);
    this.mutations.register(departmentAssignHeadMutation);
    this.mutations.register(teamCreateMutation);
    this.mutations.register(teamUpdateMutation);
    this.mutations.register(teamMoveToDepartmentMutation);
    this.mutations.register(teamSetArchivedMutation);
    this.mutations.register(teamDeleteMutation);
    this.mutations.register(teamAssignManagerMutation);
  }
}

@Module({
  providers: [HrRegistrar],
})
export class HrModule {}
