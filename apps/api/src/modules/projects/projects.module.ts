import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { projectDetailDataSource, projectsCountDataSource, projectsListDataSource, projectsStatusBreakdownDataSource, projectMembersDataSource } from "./projects.data-sources";
import { projectAddMemberMutation, projectCreateMutation, projectDeleteMutation, projectRemoveMemberMutation, projectUpdateMutation } from "./projects.mutations";
import { projectsActiveCountMetric, projectsStatusBreakdownMetric, projectsAtRiskMetric, projectsProgressMetric } from "./projects.metrics";
import { projectRagHandler } from "./projects.rag";

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
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(projectsListDataSource);
    this.dataSources.register(projectsCountDataSource);
    this.dataSources.register(projectsStatusBreakdownDataSource);
    this.dataSources.register(projectDetailDataSource);
    this.dataSources.register(projectMembersDataSource);
    this.mutations.register(projectCreateMutation);
    this.mutations.register(projectUpdateMutation);
    this.mutations.register(projectDeleteMutation);
    this.mutations.register(projectAddMemberMutation);
    this.mutations.register(projectRemoveMemberMutation);
    this.metrics.register(projectsActiveCountMetric);
    this.metrics.register(projectsStatusBreakdownMetric);
    this.metrics.register(projectsAtRiskMetric);
    this.metrics.register(projectsProgressMetric);
    this.ragSources.register(projectRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [ProjectsRegistrar],
})
export class ProjectsModule {}
