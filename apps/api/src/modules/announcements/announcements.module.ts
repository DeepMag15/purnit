import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { announcementsListDataSource } from "./announcements.data-sources";
import { announcementCreateMutation, announcementDeleteMutation } from "./announcements.mutations";

/** Same registrar pattern as every other module — see meetings.module.ts.
 * No factory/injected service needed — no external dependency. */
@Injectable()
class AnnouncementsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(announcementsListDataSource);
    this.mutations.register(announcementCreateMutation);
    this.mutations.register(announcementDeleteMutation);
  }
}

@Module({
  providers: [AnnouncementsRegistrar],
})
export class AnnouncementsModule {}
