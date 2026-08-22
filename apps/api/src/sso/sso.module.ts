import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "../auth/auth.module";
import { DataSourceRegistry } from "../data-sources/data-source-registry.service";
import { MutationRegistry } from "../mutations/mutation-registry.service";
import { ssoGetDataSource } from "./sso.data-sources";
import { ssoConfigureMutation } from "./sso.mutations";
import { SsoController } from "./sso.controller";
import { SsoStateService } from "./sso-state.service";
import { SsoBrokerService } from "./sso-broker.service";
import { SsoJitProvisionService } from "./sso-jit-provision.service";

/** Same registrar pattern as every other module — see feature-flags.module.ts. */
@Injectable()
class SsoRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
  ) {}

  onModuleInit() {
    this.dataSources.register(ssoGetDataSource);
    this.mutations.register(ssoConfigureMutation);
  }
}

@Module({
  imports: [
    // Scoped to just this module's own 3 public routes (see SsoController's
    // own doc comment) — no rate limiting exists anywhere else in this
    // codebase, and this isn't retrofitting it onto signup/verify-workspace.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    // SupabaseAdminService (SsoJitProvisionService's own JIT-provisioning +
    // generateMagicLink/verifyMagicLinkOtp calls) — AuthModule already
    // exports it as the one reusable service-role Supabase client.
    AuthModule,
  ],
  providers: [SsoRegistrar, SsoStateService, SsoBrokerService, SsoJitProvisionService],
  controllers: [SsoController],
})
export class SsoModule {}
