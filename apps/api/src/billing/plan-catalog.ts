import type { Plan, PlanPrice } from "../generated/prisma/client";

/**
 * Go-Live — the one place a Plan row is turned into the shape every pricing
 * surface renders. Four consumers share it: the public pricing endpoint
 * (`/api/public/plans`, unauthenticated), the in-app `billing.capabilities`
 * data source, the signup flow's plan validation, and the billing mutations'
 * price resolution.
 *
 * It exists so "what does Starter cost yearly" has exactly one answer in the
 * codebase. Before this, price lived on the Plan row itself and each caller
 * read it directly; with two intervals per plan that would have become four
 * slightly-different lookups.
 *
 * Nothing here calls Stripe. These functions are pure over rows already
 * loaded from our own database — that's what lets the entire public pricing
 * surface render with no Stripe account configured.
 */

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value);
}

export interface PublicPlanPrice {
  interval: BillingInterval;
  unitAmountCents: number;
  currency: string;
  /** Whether this exact price can actually go through Stripe Checkout right
   * now. False when no Stripe account is configured yet — the price still
   * displays correctly, it just can't be charged. */
  selfServe: boolean;
}

export interface PublicPlan {
  key: string;
  name: string;
  tagline: string | null;
  highlights: string[];
  seatModel: string;
  minSeats: number;
  maxSeats: number | null;
  trialDays: number;
  aiMessageDailyCap: number | null;
  sortOrder: number;
  prices: PublicPlanPrice[];
}

type PlanWithPrices = Plan & { prices: PlanPrice[] };

/** `highlights` is an untyped JSON bag on the Plan row (same treatment as
 * `entitlements`). Anything that isn't an array of strings is dropped rather
 * than crashing a public, unauthenticated endpoint over bad seed data. */
function readHighlights(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((h): h is string => typeof h === "string") : [];
}

export function toPublicPlan(plan: PlanWithPrices): PublicPlan {
  return {
    key: plan.key,
    name: plan.name,
    tagline: plan.tagline,
    highlights: readHighlights(plan.highlights),
    seatModel: plan.seatModel,
    minSeats: plan.minSeats,
    maxSeats: plan.maxSeats,
    trialDays: plan.trialDays,
    aiMessageDailyCap: plan.aiMessageDailyCap,
    sortOrder: plan.sortOrder,
    prices: plan.prices
      .filter((p): p is PlanPrice & { interval: BillingInterval } => isBillingInterval(p.interval))
      .map((p) => ({
        interval: p.interval,
        unitAmountCents: p.unitAmountCents,
        currency: p.currency,
        selfServe: !!p.stripePriceId,
      }))
      .sort((a, b) => BILLING_INTERVALS.indexOf(a.interval) - BILLING_INTERVALS.indexOf(b.interval)),
  };
}

export function findPrice(plan: PlanWithPrices, interval: BillingInterval): PlanPrice | undefined {
  return plan.prices.find((p) => p.interval === interval && p.currency === "usd");
}

/**
 * The total a customer is charged per billing period.
 *
 * A "flat" plan (Free) ignores seat count entirely; a "per_seat" plan
 * multiplies. This mirrors exactly what Stripe computes from
 * `quantity x unit_amount`, and is what the signup wizard shows before the
 * customer ever reaches Checkout — the two must agree, which is why the seat
 * clamp below is applied here rather than in the UI.
 */
export function computeTotalCents(plan: PlanWithPrices, interval: BillingInterval, seats: number): number {
  const price = findPrice(plan, interval);
  if (!price) return 0;
  return plan.seatModel === "per_seat" ? price.unitAmountCents * clampSeats(plan, seats) : price.unitAmountCents;
}

/**
 * Seats a caller asked for, forced into what the plan actually allows.
 *
 * Deliberately clamps rather than throwing: this runs on public,
 * unauthenticated input (a query param on the pricing page, a stepper value
 * at signup), where a hostile or stale value should produce a sane price,
 * not a 500. Callers that need to *reject* an impossible seat count
 * (`user.invite`'s limit check) do that separately against the real
 * subscription, not here.
 */
export function clampSeats(plan: PlanWithPrices, seats: number): number {
  const floor = Math.max(1, plan.minSeats);
  const requested = Number.isFinite(seats) ? Math.floor(seats) : floor;
  const atLeastFloor = Math.max(floor, requested);
  return plan.maxSeats === null ? atLeastFloor : Math.min(atLeastFloor, plan.maxSeats);
}
