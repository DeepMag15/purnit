import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { presenceListDataSource } from "./presence.data-sources";
import { presenceHeartbeatMutation } from "./presence.mutations";

/** Same registrar pattern as every other module — see leave.module.ts. */
@Injectable()
class PresenceRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(presenceListDataSource);
    this.mutations.register(presenceHeartbeatMutation);
  }
}

@Module({
  providers: [PresenceRegistrar],
})
export class PresenceModule {}
