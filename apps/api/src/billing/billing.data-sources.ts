import { z } from "zod";
import type { DataSourceDefinition } from "../data-sources/data-source-registry.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { StripeService } from "./stripe.service";
import { toPublicPlan } from "./plan-catalog";

const CapabilitiesParamsSchema = z.object({});

/** Factory — needs `TenantPrismaService.root` (Tenant/Plan/PlanPrice are
 * platform-root tables, unreachable via the tenant-scoped `tx` this resolver
 * otherwise gets), same reasoning as `createAnalyticsDashboardDataSource`.
 *
 * Note the `Promise.all` here is safe and deliberate: these queries run
 * against `tenantPrisma.root` — the plain unscoped client — not against a
 * shared interactive-transaction `tx`. The standing "never Promise.all on one
 * tx" rule is specifically about the single reserved connection an
 * interactive transaction holds, which is not what this is. */
export function createBillingCapabilitiesDataSource(
  tenantPrisma: TenantPrismaService,
): DataSourceDefinition<z.infer<typeof CapabilitiesParamsSchema>> {
  return {
    name: "billing.capabilities",
    paramsSchema: CapabilitiesParamsSchema,
    requiredPermission: "billing:manage",
    async resolve(_params, ctx) {
      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: ctx.tenantId } });

      const [currentPlan, allPlans, activeUsers, recentEvents] = await Promise.all([
        tenant?.planId
          ? tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId }, include: { prices: true } })
          : Promise.resolve(null),
        tenantPrisma.root.plan.findMany({ where: { isPublic: true }, include: { prices: true }, orderBy: { sortOrder: "asc" } }),
        tenantPrisma.run(ctx.tenantId, (tx) => tx.user.count({ where: { tenantId: ctx.tenantId, deletedAt: null } })),
        tenantPrisma.root.subscriptionEvent.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

      // The seat ceiling a tenant is actually held to. A paid subscription is
      // capped by what it bought; an unsubscribed tenant is capped by its
      // plan's own `maxSeats` (Free's 3). Null means genuinely uncapped —
      // only reachable on a paid plan with no `maxSeats`, which is why the
      // subscription branch is checked first.
      const seatLimit = tenant?.stripeSubscriptionId ? tenant.seatsPurchased : (currentPlan?.maxSeats ?? null);

      return {
        currentPlan: currentPlan ? toPublicPlan(currentPlan) : null,
        subscriptionStatus: tenant?.subscriptionStatus ?? null,
        billingInterval: tenant?.billingInterval ?? null,
        seatsPurchased: tenant?.seatsPurchased ?? 1,
        activeUsers,
        seatLimit,
        seatsRemaining: seatLimit === null ? null : Math.max(0, seatLimit - activeUsers),
        trialEndsAt: tenant?.trialEndsAt ?? null,
        currentPeriodEnd: tenant?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: tenant?.cancelAtPeriodEnd ?? false,
        pendingPlanKey: tenant?.pendingPlanKey ?? null,
        hasStripeCustomer: !!tenant?.stripeCustomerId,
        hasSubscription: !!tenant?.stripeSubscriptionId,
        stripeConfigured: StripeService.isConfigured(),
        availablePlans: allPlans.map(toPublicPlan),
        recentEvents: recentEvents.map((e) => ({
          type: e.type,
          fromPlanKey: e.fromPlanKey,
          toPlanKey: e.toPlanKey,
          fromSeats: e.fromSeats,
          toSeats: e.toSeats,
          createdAt: e.createdAt,
        })),
      };
    },
  };
}
