import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../../data-sources/data-source-registry.service";
import { MutationRegistry } from "../../mutations/mutation-registry.service";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { StripeService } from "../../billing/stripe.service";
import { AuthModule } from "../../auth/auth.module";
import { BillingModule } from "../../billing/billing.module";
import { accountExportDataSource } from "./account.data-sources";
import { createCloseWorkspaceMutation, createDeleteSelfMutation } from "./account.mutations";

/** Same registrar pattern as every other module — see billing.module.ts. */
@Injectable()
class AccountRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly stripe: StripeService,
  ) {}

  onModuleInit() {
    this.dataSources.register(accountExportDataSource);
    this.mutations.register(createDeleteSelfMutation(this.tenantPrisma, this.supabaseAdmin));
    this.mutations.register(createCloseWorkspaceMutation(this.tenantPrisma, this.stripe));
  }
}

@Module({
  // AuthModule exports SupabaseAdminService (the one service-role client);
  // BillingModule exports StripeService. Neither is reconstructed here.
  imports: [AuthModule, BillingModule],
  providers: [AccountRegistrar],
})
export class AccountModule {}
