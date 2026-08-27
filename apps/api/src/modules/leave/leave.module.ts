import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import {
  leaveCapabilitiesDataSource,
  leaveTypesListDataSource,
  leaveRequestsListDataSource,
  leaveRequestsPendingApprovalsDataSource,
  leaveBalancesListDataSource,
} from "./leave.data-sources";
import { leaveTypeCreateMutation, leaveSubmitMutation, leaveApproveMutation, leaveRejectMutation, leaveCancelMutation } from "./leave.mutations";
import { leaveRequestRagHandler } from "./leave.rag";

/** Same registrar pattern as every other module — see attendance.module.ts.
 * No factory/injected service needed — no external dependency, no outbox,
 * no poller. */
@Injectable()
class LeaveRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(leaveCapabilitiesDataSource);
    this.dataSources.register(leaveTypesListDataSource);
    this.dataSources.register(leaveRequestsListDataSource);
    this.dataSources.register(leaveRequestsPendingApprovalsDataSource);
    this.dataSources.register(leaveBalancesListDataSource);
    this.mutations.register(leaveTypeCreateMutation);
    this.mutations.register(leaveSubmitMutation);
    this.mutations.register(leaveApproveMutation);
    this.mutations.register(leaveRejectMutation);
    this.mutations.register(leaveCancelMutation);
    this.ragSources.register(leaveRequestRagHandler); // AI RAG Phase C
  }
}

@Module({
  providers: [LeaveRegistrar],
})
export class LeaveModule {}
