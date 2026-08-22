import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { featureFlagsListDataSource } from "./feature-flags.data-sources";
import { featureFlagSetMutation } from "./feature-flags.mutations";

/** Same registrar pattern as every other module — see leave.module.ts. */
@Injectable()
class FeatureFlagsRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(featureFlagsListDataSource);
    this.mutations.register(featureFlagSetMutation);
  }
}

@Module({
  providers: [FeatureFlagsRegistrar],
})
export class FeatureFlagsModule {}
