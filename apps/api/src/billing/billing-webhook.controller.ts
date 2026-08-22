import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import type Stripe from "stripe";
import { Prisma } from "../generated/prisma/client";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { StripeService } from "./stripe.service";

/**
 * Stripe Billing's inbound webhook — deliberately NOT under `api/mutations`/
 * `api/data` and deliberately has no `@UseGuards(JwtAuthGuard)`. This is not
 * a gap: `AuthContextMiddleware` (applied globally) is soft and never
 * blocks anything on its own, so a route that simply doesn't opt into
 * `JwtAuthGuard` is safely reachable with no auth interference — there's
 * nothing to "fall through" incorrectly. The Stripe signature check below
 * is this endpoint's *only* authentication, and it's mandatory, not
 * optional.
 *
 * Go-Live: this handler is the *only* writer of durable subscription state
 * (plan, seats, interval, period, trial, status). Every billing mutation
 * merely tells Stripe what to do and returns; nothing optimistically writes
 * what it hopes Stripe will confirm. That is what makes a dropped browser
 * redirect or a closed tab harmless.
 */
@Controller("api/webhooks/stripe")
export class BillingWebhookController {
  private readonly logger = new Logger("BillingWebhookController");

  constructor(
    private readonly stripe: StripeService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature: string | undefined) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException("Missing raw body or Stripe signature");
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody, signature);
    } catch (err) {
      // Invalid/missing signature — reject loudly, never process. There is
      // no JwtAuthGuard on this route; this check is the whole gate.
      throw new BadRequestException(`Invalid Stripe signature: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Idempotency — Stripe explicitly documents at-least-once delivery. A
    // unique-constraint violation on this insert means "already processed
    // this exact event id"; return 200 immediately rather than reprocessing
    // side effects (a duplicate notification, a redundant write).
    try {
      await this.tenantPrisma.root.stripeEvent.create({ data: { id: event.id, type: event.type } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return { received: true, duplicate: true };
      }
      throw err;
    }

    switch (event.type) {
      case "checkout.session.completed":
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
        break;
      case "customer.subscription.updated":
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription, event.id);
        break;
      case "customer.subscription.deleted":
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id);
        break;
      case "customer.subscription.trial_will_end":
        await this.onTrialWillEnd(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await this.onPaymentFailed(event.data.object as Stripe.Invoice, event.id);
        break;
      case "invoice.paid":
        await this.onInvoicePaid(event.data.object as Stripe.Invoice, event.id);
        break;
      default:
        // Stripe sends far more event types than this integration cares
        // about — unhandled types are intentionally ignored, not errors.
        break;
    }

    return { received: true };
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /**
   * In Stripe's current API version `current_period_end` lives on the
   * subscription **item**, not on the subscription itself — verified against
   * this SDK's own type definitions, not assumed. Reading it off the
   * subscription yields `undefined`, which would silently become an Invalid
   * Date rather than failing loudly.
   */
  private periodEnd(subscription: Stripe.Subscription): Date | null {
    const seconds = subscription.items?.data?.[0]?.current_period_end;
    return typeof seconds === "number" ? new Date(seconds * 1000) : null;
  }

  private seatsOf(subscription: Stripe.Subscription): number | null {
    const quantity = subscription.items?.data?.[0]?.quantity;
    return typeof quantity === "number" ? quantity : null;
  }

  /** Resolves which of our plans a live Stripe subscription is actually on,
   * by its price id. This is how a *scheduled* downgrade is detected: Stripe
   * applies phase 2 on its own and the resulting price is the only signal
   * that it happened. */
  private async planFromSubscription(subscription: Stripe.Subscription) {
    const priceId = subscription.items?.data?.[0]?.price?.id;
    if (!priceId) return null;
    const planPrice = await this.tenantPrisma.root.planPrice.findFirst({
      where: { stripePriceId: priceId },
      include: { plan: true },
    });
    return planPrice ? { plan: planPrice.plan, interval: planPrice.interval } : null;
  }

  private async tenantForCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null, context: string) {
    const customerId = typeof customer === "string" ? customer : customer?.id;
    if (!customerId) {
      this.logger.error(`${context} had no Stripe customer`);
      return null;
    }
    const tenant = await this.tenantPrisma.root.tenant.findUnique({ where: { stripeCustomerId: customerId } });
    if (!tenant) this.logger.error(`${context} for unknown Stripe customer "${customerId}"`);
    return tenant;
  }

  // -------------------------------------------------------------------------
  // handlers
  // -------------------------------------------------------------------------

  private async onCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string) {
    const tenantId = session.client_reference_id;
    const planKey = session.metadata?.planKey;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (!tenantId || !planKey || !customerId) {
      this.logger.error(`checkout.session.completed missing tenantId/planKey/customerId (session ${session.id})`);
      return;
    }

    const plan = await this.tenantPrisma.root.plan.findUnique({ where: { key: planKey } });
    if (!plan) {
      this.logger.error(`checkout.session.completed referenced unknown plan "${planKey}" (session ${session.id})`);
      return;
    }

    // Seats and interval come from the metadata we set when creating the
    // session — never from anything the browser sent back on the redirect.
    const seats = Number.parseInt(session.metadata?.seats ?? "", 10);
    const interval = session.metadata?.interval ?? null;

    const existing = await this.tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });

    // Pull the real subscription so status/period/trial reflect Stripe's
    // truth rather than an assumption that checkout always means "active" —
    // with a trial it actually means "trialing".
    let status = "active";
    let periodEnd: Date | null = null;
    let trialEnd: Date | null = null;
    if (subscriptionId && StripeService.isConfigured()) {
      try {
        const subscription = await this.stripe.getSubscription(subscriptionId);
        status = subscription.status;
        periodEnd = this.periodEnd(subscription);
        trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
      } catch (err) {
        // Never fail the webhook over an enrichment call — Stripe would
        // retry forever and the core state below is already correct.
        this.logger.warn(`Could not retrieve subscription ${subscriptionId}: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.tenantPrisma.root.tenant.update({
      where: { id: tenantId },
      data: {
        planId: plan.id,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: status,
        seatsPurchased: Number.isFinite(seats) && seats > 0 ? seats : 1,
        billingInterval: interval,
        trialEndsAt: trialEnd,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        pendingPlanKey: null,
      },
    });

    await this.recordEvent(tenantId, {
      type: "created",
      fromSeats: existing?.seatsPurchased ?? null,
      toSeats: Number.isFinite(seats) ? seats : null,
      toPlanKey: plan.key,
      interval,
      stripeEventId: eventId,
    });

    await this.notifyAdmins(tenantId, {
      type: "billing.subscriptionUpdated",
      title: status === "trialing" ? "Trial started" : "Subscription activated",
      body: status === "trialing" ? `Your ${plan.name} trial is running` : `Now on the ${plan.name} plan`,
    });
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription, eventId: string) {
    const tenant = await this.tenantForCustomer(subscription.customer, "customer.subscription.updated");
    if (!tenant) return;

    const resolved = await this.planFromSubscription(subscription);
    const seats = this.seatsOf(subscription);
    const previousPlan = tenant.planId ? await this.tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }) : null;

    // A scheduled downgrade landing shows up here as the price having
    // changed to the pending plan — that is the signal to clear the flag.
    const planChanged = !!resolved && resolved.plan.id !== tenant.planId;
    const pendingApplied = !!resolved && tenant.pendingPlanKey === resolved.plan.key;

    await this.tenantPrisma.root.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: subscription.status,
        currentPeriodEnd: this.periodEnd(subscription),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        ...(seats !== null ? { seatsPurchased: seats } : {}),
        ...(resolved ? { planId: resolved.plan.id, billingInterval: resolved.interval } : {}),
        ...(pendingApplied ? { pendingPlanKey: null } : {}),
      },
    });

    if (planChanged || (seats !== null && seats !== tenant.seatsPurchased)) {
      await this.recordEvent(tenant.id, {
        type: planChanged ? "plan_changed" : "seats_changed",
        fromPlanKey: previousPlan?.key ?? null,
        toPlanKey: resolved?.plan.key ?? null,
        fromSeats: tenant.seatsPurchased,
        toSeats: seats,
        interval: resolved?.interval ?? tenant.billingInterval,
        stripeEventId: eventId,
      });
    }

    await this.notifyAdmins(tenant.id, {
      type: "billing.subscriptionUpdated",
      title: "Subscription updated",
      body: planChanged && resolved ? `Now on the ${resolved.plan.name} plan` : `Status: ${subscription.status}`,
    });
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription, eventId: string) {
    const tenant = await this.tenantForCustomer(subscription.customer, "customer.subscription.deleted");
    if (!tenant) return;

    const previousPlan = tenant.planId ? await this.tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }) : null;

    // Reverts to the Free plan, not `null` — `null` means "no plan assigned,
    // everything entitled" (entitlement-filter.ts's Phase-1 default), which
    // would grant *more* access than the plan just cancelled. A tenant with
    // no seeded Free plan (shouldn't happen — seed.ts always creates one)
    // falls back to `null` rather than throwing, since a webhook handler
    // failing loudly here just means Stripe retries forever for no benefit.
    const freePlan = await this.tenantPrisma.root.plan.findUnique({ where: { key: "free" } });

    await this.tenantPrisma.root.tenant.update({
      where: { id: tenant.id },
      data: {
        planId: freePlan?.id ?? null,
        stripeSubscriptionId: null,
        subscriptionStatus: "canceled",
        cancelAtPeriodEnd: false,
        pendingPlanKey: null,
        billingInterval: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        // Back to the Free tier's own ceiling. Existing users over that
        // limit keep working — only new invites are blocked (see
        // assert-seat-available.ts), which is the humane direction to fail.
        seatsPurchased: 1,
      },
    });

    await this.recordEvent(tenant.id, {
      type: "canceled",
      fromPlanKey: previousPlan?.key ?? null,
      toPlanKey: freePlan?.key ?? null,
      fromSeats: tenant.seatsPurchased,
      toSeats: 1,
      stripeEventId: eventId,
    });

    await this.notifyAdmins(tenant.id, {
      type: "billing.subscriptionCanceled",
      title: "Subscription cancelled",
      body: "Reverted to the Free plan",
    });
  }

  private async onTrialWillEnd(subscription: Stripe.Subscription) {
    const tenant = await this.tenantForCustomer(subscription.customer, "customer.subscription.trial_will_end");
    if (!tenant) return;

    const endsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    await this.notifyAdmins(tenant.id, {
      type: "billing.trialEnding",
      title: "Your trial ends soon",
      body: endsAt ? `Billing starts on ${endsAt.toDateString()}` : "Billing starts shortly",
    });
  }

  /**
   * A failed payment starts a grace period — it never hard-locks the
   * workspace on the spot. Stripe retries on its own schedule for days, and
   * most failures are an expired card, not an unwilling customer; cutting off
   * a paying company's whole workspace over one declined charge would be a
   * far worse outcome than carrying them for a few days.
   *
   * `subscriptionStatus` becomes Stripe's own "past_due", which nothing in
   * the entitlement pipeline currently gates on — access is unchanged, and
   * the admins get a notification. Actual restriction, if it's ever wanted,
   * belongs behind a deliberate product decision, not here.
   */
  private async onPaymentFailed(invoice: Stripe.Invoice, eventId: string) {
    const tenant = await this.tenantForCustomer(invoice.customer, "invoice.payment_failed");
    if (!tenant) return;

    await this.tenantPrisma.root.tenant.update({
      where: { id: tenant.id },
      data: { subscriptionStatus: "past_due" },
    });

    await this.recordEvent(tenant.id, { type: "payment_failed", stripeEventId: eventId });

    await this.notifyAdmins(tenant.id, {
      type: "billing.paymentFailed",
      title: "Payment failed",
      body: "We couldn't charge your card. Update your payment method to avoid interruption.",
    });
  }

  /** Only interesting as the recovery half of the pair above — a routine
   * renewal invoice needs no action, since subscription.updated already
   * carries the new period. */
  private async onInvoicePaid(invoice: Stripe.Invoice, eventId: string) {
    const tenant = await this.tenantForCustomer(invoice.customer, "invoice.paid");
    if (!tenant || tenant.subscriptionStatus !== "past_due") return;

    await this.tenantPrisma.root.tenant.update({
      where: { id: tenant.id },
      data: { subscriptionStatus: "active" },
    });

    await this.recordEvent(tenant.id, { type: "payment_recovered", stripeEventId: eventId });

    await this.notifyAdmins(tenant.id, {
      type: "billing.paymentRecovered",
      title: "Payment received",
      body: "Your subscription is active again.",
    });
  }

  /** Append-only billing history. Never allowed to fail the webhook — an
   * audit row we couldn't write is worth a log line, not an infinite Stripe
   * retry of an event whose real effect already committed. */
  private async recordEvent(
    tenantId: string,
    data: {
      type: string;
      fromPlanKey?: string | null;
      toPlanKey?: string | null;
      fromSeats?: number | null;
      toSeats?: number | null;
      interval?: string | null;
      stripeEventId?: string | null;
    },
  ) {
    try {
      await this.tenantPrisma.root.subscriptionEvent.create({ data: { tenantId, ...data } });
    } catch (err) {
      this.logger.error(`Could not record subscription event for ${tenantId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Same "no user ctx, `tenantPrisma.run()` from a background trigger"
   * shape as `CalendarReminderProcessorService.processReminder` — the
   * closest existing precedent for a non-mutation-controller DB write in
   * this codebase. */
  private async notifyAdmins(tenantId: string, notification: { type: string; title: string; body: string }) {
    await this.tenantPrisma.run(tenantId, async (tx) => {
      const adminRole = await tx.role.findFirst({ where: { tenantId, sourceBlueprintRoleId: "role.admin" } });
      if (!adminRole) return;
      const assignments = await tx.roleAssignment.findMany({ where: { tenantId, roleId: adminRole.id } });
      if (assignments.length === 0) return;

      await tx.notification.createMany({
        data: assignments.map((a) => ({
          tenantId,
          userId: a.userId,
          type: notification.type,
          title: notification.title,
          body: notification.body,
        })),
      });
    });
  }
}
