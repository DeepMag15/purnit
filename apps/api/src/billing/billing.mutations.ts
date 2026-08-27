import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../mutations/mutation-registry.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import type { StripeService } from "./stripe.service";
import { BILLING_INTERVALS, clampSeats, findPrice, type BillingInterval } from "./plan-catalog";

interface CheckoutPre {
  url: string;
}

const IntervalSchema = z.enum(BILLING_INTERVALS);

/**
 * Go-Live — loads a plan together with its prices, which every billing
 * mutation needs. `Plan`/`PlanPrice` are platform-root tables, so this goes
 * through `tenantPrisma.root`, not the tenant-scoped `tx` — same reasoning
 * as `createUpdateBrandingMutation` in settings.mutations.ts.
 */
async function loadSelfServePlan(tenantPrisma: TenantPrismaService, planKey: string, interval: BillingInterval) {
  const plan = await tenantPrisma.root.plan.findUnique({ where: { key: planKey }, include: { prices: true } });
  if (!plan) throw new NotFoundException(`No plan "${planKey}"`);

  const price = findPrice(plan, interval);
  if (!price?.stripePriceId) {
    // Distinguishes the two genuinely different reasons, because they need
    // different things from the reader: "contact us" is a product decision,
    // "not configured" is an operator TODO.
    if (plan.seatModel === "contact") {
      throw new BadRequestException(`The ${plan.name} plan isn't self-serve — contact us to get set up`);
    }
    throw new BadRequestException(`Billing isn't configured for the ${plan.name} plan on a ${interval}ly cycle yet`);
  }

  return { plan, price, stripePriceId: price.stripePriceId };
}

/** Every billing mutation past checkout needs the tenant's live subscription.
 * Centralized so the "you have no subscription" message is identical
 * everywhere rather than drifting per mutation. */
async function loadSubscribedTenant(tenantPrisma: TenantPrismaService, tenantId: string) {
  const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundException(`No tenant "${tenantId}"`);
  if (!tenant.stripeSubscriptionId) {
    throw new BadRequestException("No active subscription — start one from the billing settings first");
  }
  return tenant;
}

// ---------------------------------------------------------------------------
// billing.createCheckoutSession
// ---------------------------------------------------------------------------

const CreateCheckoutSessionInputSchema = z.object({
  planKey: z.string(),
  interval: IntervalSchema.default("month"),
  seats: z.number().int().positive().default(1),
});

/**
 * Factory — needs `StripeService` + `TenantPrismaService.root`. The Stripe
 * API call happens entirely in `preResolve`, never inside `resolve()`'s open
 * transaction — the discipline `aiMessage.send` established for external I/O.
 *
 * `resolve()` deliberately never writes `planId`/seat/subscription fields —
 * only the signed webhook event (`checkout.session.completed`) is trusted for
 * that write. This mutation's only job is handing back a URL to redirect to;
 * never trust a client-side "success" redirect for durable state.
 */
export function createCreateCheckoutSessionMutation(
  stripe: StripeService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof CreateCheckoutSessionInputSchema>, CheckoutPre> {
  return {
    name: "billing.createCheckoutSession",
    inputSchema: CreateCheckoutSessionInputSchema,
    requiredPermission: "billing:manage",
    async preResolve(input, { tenantId, authUserId }) {
      const { plan, stripePriceId } = await loadSelfServePlan(tenantPrisma, input.planKey, input.interval);

      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException(`No tenant "${tenantId}"`);

      const actor = await tenantPrisma.run(tenantId, (tx) => tx.user.findFirst({ where: { authUserId } }));
      if (!actor) throw new NotFoundException("No user record for this session");

      // Never bill for fewer seats than the tenant already has people. A
      // customer with 8 users picking 3 seats would otherwise land in a
      // workspace that immediately blocks every future invite and silently
      // over-permits the 5 users already past the line.
      const activeUsers = await tenantPrisma.run(tenantId, (tx) => tx.user.count({ where: { tenantId, deletedAt: null } }));
      const seats = Math.max(clampSeats(plan, input.seats), activeUsers);

      const customerId = await stripe.createOrGetCustomer(tenantId, tenant.stripeCustomerId, actor.email, tenant.name);
      if (customerId !== tenant.stripeCustomerId) {
        await tenantPrisma.root.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId } });
      }

      const session = await stripe.createCheckoutSession({
        customerId,
        priceId: stripePriceId,
        tenantId,
        planKey: plan.key,
        seats,
        interval: input.interval,
        // A tenant that already had a subscription is changing plans, not
        // starting fresh — re-granting the trial each time would let anyone
        // loop it forever.
        trialDays: tenant.stripeSubscriptionId ? 0 : plan.trialDays,
        successUrl: `${process.env.APP_BASE_URL}/workspace/settings?billing=success`,
        cancelUrl: `${process.env.APP_BASE_URL}/workspace/settings?billing=cancelled`,
      });
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");

      return { url: session.url };
    },
    async resolve(_input, _ctx, _tx, pre) {
      if (!pre) throw new Error("Missing Checkout session");
      return pre;
    },
  };
}

// ---------------------------------------------------------------------------
// billing.createPortalSession
// ---------------------------------------------------------------------------

const CreatePortalSessionInputSchema = z.object({});

/** Same factory/preResolve shape as above, simpler — no plan lookup, just
 * needs the tenant's existing Stripe customer. The Portal stays responsible
 * for payment methods and invoice history; plan/seat changes are real
 * mutations below so they can be permission-gated and audited. */
export function createCreatePortalSessionMutation(
  stripe: StripeService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof CreatePortalSessionInputSchema>, CheckoutPre> {
  return {
    name: "billing.createPortalSession",
    inputSchema: CreatePortalSessionInputSchema,
    requiredPermission: "billing:manage",
    async preResolve(_input, { tenantId }) {
      const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant?.stripeCustomerId) {
        throw new BadRequestException("No billing account yet — upgrade to a paid plan first");
      }

      const session = await stripe.createPortalSession({
        customerId: tenant.stripeCustomerId,
        returnUrl: `${process.env.APP_BASE_URL}/workspace/settings`,
      });

      return { url: session.url };
    },
    async resolve(_input, _ctx, _tx, pre) {
      if (!pre) throw new Error("Missing Portal session");
      return pre;
    },
  };
}

// ---------------------------------------------------------------------------
// billing.changePlan
// ---------------------------------------------------------------------------

const ChangePlanInputSchema = z.object({
  planKey: z.string(),
  interval: IntervalSchema.default("month"),
});

interface ChangePlanPre {
  scheduled: boolean;
  planKey: string;
  interval: BillingInterval;
}

/**
 * Moves an existing subscription to a different tier and/or interval.
 *
 * Direction decides everything. An **upgrade** applies immediately and bills
 * the prorated difference, because the customer is asking for more and
 * expects it now. A **downgrade** is scheduled for period end and bills
 * nothing, because they already paid for the current period and taking
 * capability away mid-cycle for no refund would be indefensible.
 *
 * "Upgrade" is decided by the plan's own `sortOrder`, which is the catalog's
 * declared ladder — not by comparing prices, which would misclassify an
 * interval switch (yearly costs more per charge but isn't a tier upgrade).
 */
export function createChangePlanMutation(
  stripe: StripeService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof ChangePlanInputSchema>, ChangePlanPre> {
  return {
    name: "billing.changePlan",
    inputSchema: ChangePlanInputSchema,
    requiredPermission: "billing:manage",
    async preResolve(input, { tenantId }) {
      const tenant = await loadSubscribedTenant(tenantPrisma, tenantId);
      const { plan, stripePriceId } = await loadSelfServePlan(tenantPrisma, input.planKey, input.interval);

      const current = tenant.planId ? await tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }) : null;
      if (current?.key === plan.key && tenant.billingInterval === input.interval) {
        throw new ConflictException(`Already on the ${plan.name} plan, billed ${input.interval}ly`);
      }

      const isUpgrade = !current || plan.sortOrder >= current.sortOrder;

      if (isUpgrade) {
        // Drop any pending downgrade first — otherwise Stripe's schedule
        // would quietly pull them back down at period end, undoing the
        // upgrade they just paid a prorated charge for.
        if (tenant.pendingPlanKey) {
          await stripe.releaseScheduleForSubscription(tenant.stripeSubscriptionId!);
        }
        await stripe.updateSubscription({
          subscriptionId: tenant.stripeSubscriptionId!,
          priceId: stripePriceId,
          seats: tenant.seatsPurchased,
          prorationBehavior: "always_invoice",
        });
        // Durable state still lands via customer.subscription.updated — this
        // call only tells Stripe what to do.
        return { scheduled: false, planKey: plan.key, interval: input.interval };
      }

      // Downgrade — Stripe holds the change until the period ends via a
      // subscription schedule, so the customer keeps what they paid for and
      // we don't have to run a job of our own to apply it.
      await stripe.scheduleChangeAtPeriodEnd({
        subscriptionId: tenant.stripeSubscriptionId!,
        newPriceId: stripePriceId,
        seats: tenant.seatsPurchased,
      });
      return { scheduled: true, planKey: plan.key, interval: input.interval };
    },
    async resolve(_input, ctx, _tx, pre) {
      if (!pre) throw new Error("Missing plan change");

      if (pre.scheduled) {
        await tenantPrisma.root.tenant.update({
          where: { id: ctx.tenantId },
          data: { pendingPlanKey: pre.planKey },
        });
      } else {
        // An upgrade supersedes any downgrade the customer previously
        // scheduled — leaving it set would silently undo the upgrade at
        // period end.
        await tenantPrisma.root.tenant.update({
          where: { id: ctx.tenantId },
          data: { pendingPlanKey: null },
        });
      }

      return { scheduled: pre.scheduled, planKey: pre.planKey, interval: pre.interval };
    },
  };
}

// ---------------------------------------------------------------------------
// billing.updateSeats
// ---------------------------------------------------------------------------

const UpdateSeatsInputSchema = z.object({ seats: z.number().int().positive() });

interface UpdateSeatsPre {
  seats: number;
  immediate: boolean;
}

/**
 * Changes how many seats the subscription is billed for.
 *
 * Adding seats applies immediately and is prorated — someone is trying to
 * invite a colleague right now. Removing seats is refused below the current
 * active user count (there is no sensible way to bill 5 seats for 8 people),
 * and otherwise takes effect without a credit; a mid-cycle refund for seats
 * already used would be an obvious abuse channel.
 */
export function createUpdateSeatsMutation(
  stripe: StripeService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof UpdateSeatsInputSchema>, UpdateSeatsPre> {
  return {
    name: "billing.updateSeats",
    inputSchema: UpdateSeatsInputSchema,
    requiredPermission: "billing:manage",
    async preResolve(input, { tenantId }) {
      const tenant = await loadSubscribedTenant(tenantPrisma, tenantId);
      const plan = tenant.planId
        ? await tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId }, include: { prices: true } })
        : null;
      if (!plan) throw new BadRequestException("No plan on this subscription");

      const seats = clampSeats(plan, input.seats);
      if (seats === tenant.seatsPurchased) {
        throw new ConflictException(`Already subscribed for ${seats} seat${seats === 1 ? "" : "s"}`);
      }

      const activeUsers = await tenantPrisma.run(tenantId, (tx) => tx.user.count({ where: { tenantId, deletedAt: null } }));
      if (seats < activeUsers) {
        throw new BadRequestException(
          `This workspace has ${activeUsers} active users — remove people before reducing to ${seats} seats`,
        );
      }

      const immediate = seats > tenant.seatsPurchased;
      await stripe.updateSubscription({
        subscriptionId: tenant.stripeSubscriptionId!,
        seats,
        prorationBehavior: immediate ? "always_invoice" : "none",
      });

      return { seats, immediate };
    },
    async resolve(_input, _ctx, _tx, pre) {
      if (!pre) throw new Error("Missing seat change");
      // `seatsPurchased` itself is written by customer.subscription.updated,
      // like every other durable subscription field.
      return { seats: pre.seats, immediate: pre.immediate };
    },
  };
}

// ---------------------------------------------------------------------------
// billing.cancelSubscription / billing.resumeSubscription
// ---------------------------------------------------------------------------

const EmptyInputSchema = z.object({});

/** Cancels at period end, never immediately — access continues until the
 * period the customer already paid for actually ends. The plan revert to Free
 * happens when Stripe later sends `customer.subscription.deleted`. */
export function createCancelSubscriptionMutation(
  stripe: StripeService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof EmptyInputSchema>, { cancelAt: Date | null }> {
  return {
    name: "billing.cancelSubscription",
    inputSchema: EmptyInputSchema,
    requiredPermission: "billing:manage",
    async preResolve(_input, { tenantId }) {
      const tenant = await loadSubscribedTenant(tenantPrisma, tenantId);
      if (tenant.cancelAtPeriodEnd) throw new ConflictException("This subscription is already set to cancel");

      await stripe.cancelSubscriptionAtPeriodEnd(tenant.stripeSubscriptionId!);
      return { cancelAt: tenant.currentPeriodEnd };
    },
    async resolve(_input, ctx, _tx, pre) {
      await tenantPrisma.root.tenant.update({
        where: { id: ctx.tenantId },
        data: { cancelAtPeriodEnd: true },
      });
      await tenantPrisma.root.subscriptionEvent.create({
        data: { tenantId: ctx.tenantId, type: "canceled" },
      });
      return { cancelAtPeriodEnd: true, cancelAt: pre?.cancelAt ?? null };
    },
  };
}

/** Clears a pending cancellation before the period actually ends. */
export function createResumeSubscriptionMutation(
  stripe: StripeService,
  tenantPrisma: TenantPrismaService,
): MutationDefinition<z.infer<typeof EmptyInputSchema>, Record<string, never>> {
  return {
    name: "billing.resumeSubscription",
    inputSchema: EmptyInputSchema,
    requiredPermission: "billing:manage",
    async preResolve(_input, { tenantId }) {
      const tenant = await loadSubscribedTenant(tenantPrisma, tenantId);
      if (!tenant.cancelAtPeriodEnd) throw new ConflictException("This subscription isn't scheduled to cancel");

      await stripe.resumeSubscription(tenant.stripeSubscriptionId!);
      return {};
    },
    async resolve(_input, ctx) {
      await tenantPrisma.root.tenant.update({
        where: { id: ctx.tenantId },
        data: { cancelAtPeriodEnd: false },
      });
      await tenantPrisma.root.subscriptionEvent.create({
        data: { tenantId: ctx.tenantId, type: "resumed" },
      });
      return { cancelAtPeriodEnd: false };
    },
  };
}
