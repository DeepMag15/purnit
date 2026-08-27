import { Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { DataSourceRegistry } from "../data-sources/data-source-registry.service";
import { MutationRegistry } from "../mutations/mutation-registry.service";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { StripeService } from "./stripe.service";
import { createBillingCapabilitiesDataSource } from "./billing.data-sources";
import {
  createCancelSubscriptionMutation,
  createChangePlanMutation,
  createCreateCheckoutSessionMutation,
  createCreatePortalSessionMutation,
  createResumeSubscriptionMutation,
  createUpdateSeatsMutation,
} from "./billing.mutations";
import { BillingWebhookController } from "./billing-webhook.controller";
import { PublicPlansController } from "./public-plans.controller";

/** Same registrar pattern as every other module — see leave.module.ts. */
@Injectable()
class BillingRegistrar implements OnModuleInit {
  constructor(
    private readonly dataSources: DataSourceRegistry,
    private readonly mutations: MutationRegistry,
    private readonly stripe: StripeService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  onModuleInit() {
    this.dataSources.register(createBillingCapabilitiesDataSource(this.tenantPrisma));
    this.mutations.register(createCreateCheckoutSessionMutation(this.stripe, this.tenantPrisma));
    this.mutations.register(createCreatePortalSessionMutation(this.stripe, this.tenantPrisma));
    // Go-Live — the plan/seat lifecycle. Deliberately real mutations rather
    // than deferring everything to Stripe's Billing Portal: these are product
    // decisions we want permission-gated (`billing:manage`) and recorded in
    // `SubscriptionEvent`. The Portal keeps what it's genuinely better at —
    // payment methods and invoice history.
    this.mutations.register(createChangePlanMutation(this.stripe, this.tenantPrisma));
    this.mutations.register(createUpdateSeatsMutation(this.stripe, this.tenantPrisma));
    this.mutations.register(createCancelSubscriptionMutation(this.stripe, this.tenantPrisma));
    this.mutations.register(createResumeSubscriptionMutation(this.stripe, this.tenantPrisma));
  }
}

@Module({
  providers: [StripeService, BillingRegistrar],
  controllers: [BillingWebhookController, PublicPlansController],
  exports: [StripeService],
})
export class BillingModule {}
