import { Controller, Get, Header } from "@nestjs/common";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { StripeService } from "./stripe.service";
import { toPublicPlan, type PublicPlan } from "./plan-catalog";

/**
 * Go-Live — the public pricing catalog.
 *
 * Deliberately unauthenticated, like `/auth/signup` and
 * `/auth/verify-workspace`: the marketing site and the first step of the
 * signup wizard are read by people who do not have an account yet, by
 * definition. `AuthContextMiddleware` is soft and never blocks, so a route
 * that simply doesn't opt into `JwtAuthGuard` is safely reachable — the same
 * reasoning the Stripe webhook controller already documents.
 *
 * It exposes nothing tenant-owned. `Plan`/`PlanPrice` are platform-root
 * catalog tables with no `tenant_id` at all (which is also why neither
 * carries an RLS policy), and every field returned here is content we
 * publish on a public pricing page on purpose. There is no per-tenant
 * pricing, so there is nothing here to leak between tenants.
 *
 * Non-public plans are filtered out — that is what lets a superseded tier
 * (the legacy "pro" plan) keep working for the tenants already on it without
 * being offered to anyone new.
 */
@Controller("api/public/plans")
export class PublicPlansController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  // The catalog changes when the seed runs, not per request. A short shared
  // cache keeps a traffic spike on the landing page off the database while
  // still letting a price correction propagate within a minute.
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  async list(): Promise<{ plans: PublicPlan[]; stripeConfigured: boolean }> {
    const plans = await this.tenantPrisma.root.plan.findMany({
      where: { isPublic: true },
      include: { prices: true },
      orderBy: { sortOrder: "asc" },
    });

    return {
      plans: plans.map(toPublicPlan),
      // Lets the signup wizard decide up front whether its final step is a
      // Stripe redirect or the "we'll collect payment later" path, without
      // needing a failed round-trip to find out.
      stripeConfigured: StripeService.isConfigured(),
    };
  }
}
