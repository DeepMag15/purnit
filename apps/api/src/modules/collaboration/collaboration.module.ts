import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { peopleDirectoryDataSource } from "./collaboration.data-sources";

/**
 * The collaboration boundary — who may reach whom.
 *
 * Its own module rather than a corner of Chat, because three separate
 * surfaces depend on the same answer: the Chat people picker, the DM
 * mutation that must agree with it, and the colleague pickers on Course and
 * Client detail. See `collaboration-reach.ts` for the rule itself.
 */
@Injectable()
class CollaborationRegistrar implements OnModuleInit {
  constructor(private readonly dataSources: DataSourceRegistry) {}

  onModuleInit() {
    this.dataSources.register(peopleDirectoryDataSource);
  }
}

@Module({
  providers: [CollaborationRegistrar],
})
export class CollaborationModule {}
