import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { JitsiService } from "../../integrations/jitsi.service";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { RagSourceRegistry } from "../../ai/retrieval/rag-source-registry.service";
import { meetingsListDataSource, meetingsInviteCandidatesDataSource, meetingsCapabilitiesDataSource } from "./meetings.data-sources";
import { meetingRagHandler } from "./meetings.rag";
import { meetingsHeldThisWeekMetric, meetingsTimelineMetric } from "./meetings.metrics";
import {
  meetingCreateMutation,
  meetingCancelMutation,
  meetingAddParticipantMutation,
  meetingRemoveParticipantMutation,
  createMeetingGetJoinInfoMutation,
} from "./meetings.mutations";

/** Same registrar pattern as every other module — see chat.module.ts. */
@Injectable()
class MeetingsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly jitsi: JitsiService,
    private readonly metrics: MetricRegistry,
    private readonly ragSources: RagSourceRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(meetingsListDataSource);
    this.dataSources.register(meetingsInviteCandidatesDataSource);
    this.dataSources.register(meetingsCapabilitiesDataSource);
    this.mutations.register(meetingCreateMutation);
    this.mutations.register(meetingCancelMutation);
    this.mutations.register(meetingAddParticipantMutation);
    this.mutations.register(meetingRemoveParticipantMutation);
    this.mutations.register(createMeetingGetJoinInfoMutation(this.jitsi));
    this.ragSources.register(meetingRagHandler); // AI RAG Phase C
    this.metrics.register(meetingsHeldThisWeekMetric);
    this.metrics.register(meetingsTimelineMetric);
  }
}

@Module({
  providers: [MeetingsRegistrar, JitsiService],
})
export class MeetingsModule {}
