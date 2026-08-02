import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { projectsCountDataSource, projectsListDataSource, projectsStatusBreakdownDataSource } from "./projects.data-sources";
import { projectAddMemberMutation, projectCreateMutation, projectDeleteMutation, projectRemoveMemberMutation, projectUpdateMutation } from "./projects.mutations";

/** Registers the Projects module's data sources/mutations at boot. This
 * registrar pattern — not a bigger `ModuleDefinition` abstraction with
 * blueprintFragments/entitlementKey/etc. — is the Phase 1 scope: build the
 * shared piece (DataSourceRegistry/MutationRegistry) once two modules
 * (Projects now, Tasks in Stage 9) actually need the identical mechanism,
 * not the full plugin system ARCHITECTURE §9 describes for hypothetical
 * future modules that don't exist yet. */
@Injectable()
class ProjectsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(projectsListDataSource);
    this.dataSources.register(projectsCountDataSource);
    this.dataSources.register(projectsStatusBreakdownDataSource);
    this.mutations.register(projectCreateMutation);
    this.mutations.register(projectUpdateMutation);
    this.mutations.register(projectDeleteMutation);
    this.mutations.register(projectAddMemberMutation);
    this.mutations.register(projectRemoveMemberMutation);
  }
}

@Module({
  providers: [ProjectsRegistrar],
})
export class ProjectsModule {}
