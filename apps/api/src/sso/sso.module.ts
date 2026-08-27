import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
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
    // Go-Live, Phase 04 — this module's own `ThrottlerModule.forRoot` is
    // gone. Rate limiting is now global (AppModule), and registering a second
    // root here would give SSO routes two independent guards with separate
    // budgets. The same 20/min limit still applies, via the `sso` named
    // throttler declared in throttling/throttle.config.ts.
    // SupabaseAdminService (SsoJitProvisionService's own JIT-provisioning +
    // generateMagicLink/verifyMagicLinkOtp calls) — AuthModule already
    // exports it as the one reusable service-role Supabase client.
    AuthModule,
  ],
  providers: [SsoRegistrar, SsoStateService, SsoBrokerService, SsoJitProvisionService],
  controllers: [SsoController],
})
export class SsoModule {}
