import { Injectable } from "@nestjs/common";
import Stripe from "stripe";

/**
 * Stripe Billing — thin wrapper around the Stripe Node SDK, same shape as
 * `email/email.service.ts`. Every method here does the one external call it
 * names and nothing else — no business logic, no `tx` access. Callers
 * (`billing.mutations.ts`, `billing-webhook.controller.ts`) own everything
 * about *when* to call these and what to do with the result.
 *
 * The `Stripe` client is constructed lazily, not in a field initializer —
 * same principle `AiProviderService`'s own doc comment states verbatim:
 * "Constructing this class never throws even with no key configured — that
 * would take down the entire API at boot for an optional feature." Found
 * live: an eager `new Stripe(process.env.STRIPE_SECRET_KEY ?? "")` field
 * initializer crashed the *entire* NestJS app at startup in this exact
 * environment (no real Stripe key configured yet) — the SDK's constructor
 * itself throws on an empty string, not just on first real API call.
 */
@Injectable()
export class StripeService {
  private client: Stripe | null = null;

  /** No Stripe keys configured at all — the Billing card should show a
   * clear "not configured" state rather than every call failing opaquely.
   * Same `isConfigured()` precedent as `AiProviderService`. */
  static isConfigured(): boolean {
    return !!process.env.STRIPE_SECRET_KEY;
  }

  private resolve(): Stripe {
    if (this.client) return this.client;
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY to enable billing.");
    }
    this.client = new Stripe(process.env.STRIPE_SECRET_KEY);
    return this.client;
  }

  async createOrGetCustomer(tenantId: string, existingCustomerId: string | null, email: string, name: string): Promise<string> {
    if (existingCustomerId) return existingCustomerId;
    const customer = await this.resolve().customers.create({ email, name, metadata: { tenantId } });
    return customer.id;
  }

  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    tenantId: string;
    planKey: string;
    /** Go-Live — the subscription quantity. Stripe multiplies the price's
     * unit amount by this, which is exactly how per-seat billing works;
     * there is no separate "seats" concept in Stripe to configure. */
    seats: number;
    interval: string;
    trialDays: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<Stripe.Checkout.Session> {
    return this.resolve().checkout.sessions.create({
      customer: params.customerId,
      // The webhook's own resolution keys — checkout.session.completed reads
      // these back directly off the Session object itself (not the
      // Subscription, whose metadata propagation from Checkout isn't
      // guaranteed the same way), so it never needs a second price->plan
      // lookup to know which tenant just paid for which plan. `seats` and
      // `interval` ride along for the same reason: the webhook is the only
      // thing trusted to write them, so it must be able to read them without
      // trusting anything the browser sends back.
      client_reference_id: params.tenantId,
      metadata: { planKey: params.planKey, seats: String(params.seats), interval: params.interval },
      mode: "subscription",
      line_items: [{ price: params.priceId, quantity: params.seats }],
      // Card is still collected up front; the customer just isn't charged
      // until the trial ends. Omitted entirely when trialDays is 0 — passing
      // `trial_period_days: 0` is not the same as passing nothing.
      ...(params.trialDays > 0
        ? { subscription_data: { trial_period_days: params.trialDays, metadata: { tenantId: params.tenantId } } }
        : { subscription_data: { metadata: { tenantId: params.tenantId } } }),
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.resolve().subscriptions.retrieve(subscriptionId);
  }

  /**
   * Changes the price and/or quantity on an existing subscription.
   *
   * Stripe requires the existing subscription *item* id to swap a price — a
   * subscription can hold several items, and this integration always uses
   * exactly one (one plan, one interval), so the first item is the right and
   * only target. Retrieving it here rather than storing the item id keeps
   * our schema smaller and avoids a second thing to keep in sync.
   *
   * `prorationBehavior` is the caller's decision, not a default here:
   * upgrades bill the difference immediately ("always_invoice"), scheduled
   * downgrades don't ("none"). Getting this wrong is the difference between
   * a surprise charge and a free upgrade, so it is never implicit.
   */
  async updateSubscription(params: {
    subscriptionId: string;
    priceId?: string;
    seats?: number;
    prorationBehavior: "always_invoice" | "create_prorations" | "none";
  }): Promise<Stripe.Subscription> {
    const client = this.resolve();
    const existing = await client.subscriptions.retrieve(params.subscriptionId);
    const item = existing.items.data[0];
    if (!item) throw new Error(`Stripe subscription ${params.subscriptionId} has no line items`);

    return client.subscriptions.update(params.subscriptionId, {
      items: [
        {
          id: item.id,
          ...(params.priceId ? { price: params.priceId } : {}),
          ...(params.seats !== undefined ? { quantity: params.seats } : {}),
        },
      ],
      proration_behavior: params.prorationBehavior,
    });
  }

  /**
   * Schedules a plan change to take effect when the current period ends.
   *
   * Uses a Stripe **Subscription Schedule**, which is the primitive built for
   * exactly this, rather than the tempting approximations: swapping the price
   * with `proration_behavior: "none"` changes it *now* (the customer loses
   * what they paid for), and waiting for an `invoice.paid` webhook to swap it
   * later bills one extra cycle at the old rate before the change lands.
   *
   * Phase 1 pins the existing item/price to the current period; phase 2
   * starts the new price immediately afterwards. Stripe applies phase 2 on
   * its own and emits `customer.subscription.updated` when it does, so the
   * durable write still happens through the webhook like everything else.
   */
  async scheduleChangeAtPeriodEnd(params: {
    subscriptionId: string;
    newPriceId: string;
    seats: number;
  }): Promise<Stripe.SubscriptionSchedule> {
    const client = this.resolve();
    const subscription = await client.subscriptions.retrieve(params.subscriptionId);

    // A subscription can only be attached to one schedule. Reuse the existing
    // one when the customer changes their mind about a pending downgrade,
    // rather than failing on Stripe's own uniqueness error.
    const scheduleId = typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id;
    const schedule = scheduleId
      ? await client.subscriptionSchedules.retrieve(scheduleId)
      : await client.subscriptionSchedules.create({ from_subscription: params.subscriptionId });

    const current = schedule.phases[0];
    if (!current) throw new Error(`Stripe schedule ${schedule.id} has no current phase`);

    return client.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: current.items.map((i) => ({
            price: typeof i.price === "string" ? i.price : i.price.id,
            quantity: i.quantity,
          })),
          start_date: current.start_date,
          end_date: current.end_date,
        },
        { items: [{ price: params.newPriceId, quantity: params.seats }] },
      ],
    });
  }

  /** Drops a pending scheduled change, leaving the live subscription exactly
   * as it is. Releasing (not cancelling) the schedule is deliberate —
   * cancelling a schedule can cancel the subscription with it. */
  async releaseScheduleForSubscription(subscriptionId: string): Promise<void> {
    const client = this.resolve();
    const subscription = await client.subscriptions.retrieve(subscriptionId);
    const scheduleId = typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id;
    if (!scheduleId) return;
    await client.subscriptionSchedules.release(scheduleId);
  }

  /** Cancels at period end rather than immediately — the customer keeps what
   * they already paid for. The actual plan revert happens when Stripe later
   * sends `customer.subscription.deleted`, never here. */
  async cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.resolve().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }

  /** Clears a pending cancellation, provided the period hasn't ended yet. */
  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.resolve().subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  }

  async createPortalSession(params: { customerId: string; returnUrl: string }): Promise<Stripe.BillingPortal.Session> {
    return this.resolve().billingPortal.sessions.create({ customer: params.customerId, return_url: params.returnUrl });
  }

  /** Throws if the signature doesn't match — the caller (the webhook
   * controller) is expected to catch this and reject the request; there is
   * no valid fallback for a bad signature. */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.resolve().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET ?? "");
  }
}
