/**
 * Go-Live, Phase 02 — the public plan catalog, as the marketing site sees it.
 *
 * Mirrors the API's `toPublicPlan` shape (apps/api/src/billing/plan-catalog.ts).
 * Deliberately a hand-written interface rather than an import from the shared
 * manifest-schema package: this is a REST response contract, not part of the
 * workspace manifest, and putting it in the shared package would imply the
 * renderer knows about billing, which it does not.
 */

export type BillingInterval = "month" | "year";

export interface PublicPlanPrice {
  interval: BillingInterval;
  unitAmountCents: number;
  currency: string;
  /** False until real Stripe price ids are configured. The price still
   * displays — it just cannot be charged yet. */
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

export interface PublicPlanCatalog {
  plans: PublicPlan[];
  stripeConfigured: boolean;
}

export function priceFor(plan: PublicPlan, interval: BillingInterval): PublicPlanPrice | undefined {
  return plan.prices.find((p) => p.interval === interval);
}

/** "Contact us" tiers have no price at all — distinct from a $0 price. */
export function isContactTier(plan: PublicPlan): boolean {
  return plan.seatModel === "contact" || plan.prices.length === 0;
}

/**
 * Money, formatted the way a pricing page should: whole dollars when the
 * amount is whole, cents only when they actually exist. `$12` reads as a
 * price; `$12.00` reads as a spreadsheet.
 */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

/**
 * What one seat costs per month on a given interval — the number a pricing
 * card shows large. A yearly plan is divided back down to a monthly figure
 * because that is the only way the two columns are comparable at a glance;
 * the real once-a-year charge is always shown alongside it, never instead
 * of it, so nobody is misled about what actually leaves their account.
 */
export function monthlyEquivalentCents(price: PublicPlanPrice): number {
  return price.interval === "year" ? Math.round(price.unitAmountCents / 12) : price.unitAmountCents;
}

/** How many months of the monthly price the yearly price saves. Derived
 * rather than hardcoded, so changing the seeded discount changes the copy. */
export function monthsSavedYearly(plan: PublicPlan): number | null {
  const monthly = priceFor(plan, "month");
  const yearly = priceFor(plan, "year");
  if (!monthly || !yearly || monthly.unitAmountCents === 0) return null;
  const saved = (monthly.unitAmountCents * 12 - yearly.unitAmountCents) / monthly.unitAmountCents;
  return saved > 0 ? Math.round(saved) : null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Server-side catalog fetch.
 *
 * Returns `null` rather than throwing on any failure, and callers render a
 * client-side fallback when it does. That is deliberate: `next build` runs in
 * CI with no API reachable, and a marketing page must never fail to build
 * because a backend was down. `revalidate` lets the statically-generated page
 * heal itself once the API is up, without a redeploy.
 */
export async function fetchPlanCatalog(): Promise<PublicPlanCatalog | null> {
  try {
    const res = await fetch(`${API_URL}/api/public/plans`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as PublicPlanCatalog;
  } catch {
    return null;
  }
}
