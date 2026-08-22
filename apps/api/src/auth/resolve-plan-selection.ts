import { Logger } from "@nestjs/common";
import { StripeService } from "../billing/stripe.service";
import type { SignupInput } from "./signup.schema";

const logger = new Logger("ResolvePlanSelection");

/** Only the fields this decision actually reads. Keeping it structural
 * rather than importing Prisma's `Plan` keeps the function pure and trivial
 * to test — the same reason `materialize-roles.ts` takes plain shapes. */
export interface PlanForSelection {
  id: string;
  key: string;
  isPublic: boolean;
  seatModel: string;
  minSeats: number;
  maxSeats: number | null;
  prices: { interval: string; currency: string; unitAmountCents: number; stripePriceId: string | null }[];
}

export interface PlanSelection {
  planId: string | null;
  planKey: string | null;
  interval: string | null;
  seats: number;
  subscriptionStatus: string | null;
  checkoutRequired: boolean;
}

/**
 * Go-Live, Phase 03 — turns the signup wizard's plan choice into the fields a
 * new tenant is actually created with.
 *
 * Every value is re-derived from the real Plan catalog rather than trusted as
 * sent, because `/auth/signup` is public and unauthenticated.
 *
 * **A caller asking for something unavailable falls back to Free instead of
 * erroring.** That is deliberate: signup is the worst possible moment to hard-
 * fail someone over a stale pricing link or a tier that was withdrawn since
 * they opened the tab, and landing on Free is both safe and fixable in two
 * clicks from billing settings. The alternative — a 400 on the last step of a
 * signup wizard — loses the customer entirely.
 *
 * Nothing here charges anyone. A paid selection is recorded as
 * `"pending_payment"`, never `"active"`; only the signed Stripe webhook is
 * ever trusted to record a real subscription.
 */
export function resolvePlanSelection(
  input: Pick<SignupInput, "planKey" | "interval" | "seats">,
  freePlan: { id: string; key: string } | null,
  plan: PlanForSelection | null,
): PlanSelection {
  const fallback: PlanSelection = {
    planId: freePlan?.id ?? null,
    planKey: freePlan?.key ?? null,
    interval: null,
    seats: 1,
    subscriptionStatus: null,
    checkoutRequired: false,
  };

  if (!input.planKey || input.planKey === "free") return fallback;

  // Unknown, withdrawn (a superseded tier still serving its existing
  // tenants), or "contact us" — none are self-serve provisionable.
  if (!plan || !plan.isPublic || plan.seatModel === "contact") {
    logger.warn(`Signup requested unavailable plan "${input.planKey}"; provisioning on Free instead`);
    return fallback;
  }

  const interval = input.interval ?? "month";
  const price = plan.prices.find((p) => p.interval === interval && p.currency === "usd");
  if (!price) {
    logger.warn(`Signup requested plan "${plan.key}" with no ${interval}ly price; provisioning on Free instead`);
    return fallback;
  }

  // Clamped to the plan's own bounds, exactly as `clampSeats` does for every
  // other billing path — the wizard quotes a price built from these same
  // limits, so the provisioned seat count has to agree with it.
  const floor = Math.max(1, plan.minSeats);
  const requested = Math.max(floor, input.seats ?? floor);
  const seats = plan.maxSeats === null ? requested : Math.min(requested, plan.maxSeats);

  // A $0 tier needs no payment even if it isn't the Free plan itself.
  const payable = price.unitAmountCents > 0;

  return {
    planId: plan.id,
    planKey: plan.key,
    interval,
    seats,
    // "pending_payment" is our own value, not one of Stripe's — it means
    // "this workspace chose a paid tier but no subscription exists yet." The
    // moment Checkout completes, the webhook overwrites it with Stripe's real
    // status ("trialing" or "active").
    subscriptionStatus: payable ? "pending_payment" : null,
    // Only true when a payment could actually be taken right now. Without a
    // configured Stripe account the workspace is still provisioned on the
    // chosen tier — it just carries "pending_payment" until billing is live.
    checkoutRequired: payable && !!price.stripePriceId && StripeService.isConfigured(),
  };
}
