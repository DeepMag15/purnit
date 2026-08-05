import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { JitsiService } from "../../integrations/jitsi.service";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { MetricRegistry } from "../../metrics/metric-registry.service";
import { meetingsListDataSource, meetingsInviteCandidatesDataSource } from "./meetings.data-sources";
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
  ) {}

  onModuleInit() {
    this.dataSources.register(meetingsListDataSource);
    this.dataSources.register(meetingsInviteCandidatesDataSource);
    this.mutations.register(meetingCreateMutation);
    this.mutations.register(meetingCancelMutation);
    this.mutations.register(meetingAddParticipantMutation);
    this.mutations.register(meetingRemoveParticipantMutation);
    this.mutations.register(createMeetingGetJoinInfoMutation(this.jitsi));
    this.metrics.register(meetingsHeldThisWeekMetric);
    this.metrics.register(meetingsTimelineMetric);
  }
}

@Module({
  providers: [MeetingsRegistrar, JitsiService],
})
export class MeetingsModule {}
