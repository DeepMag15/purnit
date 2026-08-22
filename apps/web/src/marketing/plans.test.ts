import { describe, expect, it } from "vitest";
import {
  formatUsd,
  isContactTier,
  monthlyEquivalentCents,
  monthsSavedYearly,
  priceFor,
  type PublicPlan,
  type PublicPlanPrice,
} from "./plans";

/**
 * Go-Live, Phase 02 — the marketing site's pricing math.
 *
 * Tested because this is the one place on the public site where a bug is
 * directly costly: it shows a prospective customer a number they will be
 * charged. The presentational sections around it are deliberately untested,
 * same "test what's actually new and risky, not what's cosmetic" discipline
 * every prior frontend phase has used.
 */

const price = (interval: "month" | "year", cents: number, selfServe = true): PublicPlanPrice => ({
  interval,
  unitAmountCents: cents,
  currency: "usd",
  selfServe,
});

const plan = (overrides: Partial<PublicPlan> = {}): PublicPlan => ({
  key: "starter",
  name: "Starter",
  tagline: null,
  highlights: [],
  seatModel: "per_seat",
  minSeats: 3,
  maxSeats: null,
  trialDays: 14,
  aiMessageDailyCap: 500,
  sortOrder: 2,
  prices: [price("month", 1200), price("year", 12000)],
  ...overrides,
});

describe("formatUsd", () => {
  it("shows whole dollars without trailing cents", () => {
    // "$12" reads as a price; "$12.00" reads as a spreadsheet.
    expect(formatUsd(1200)).toBe("$12");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(29000)).toBe("$290");
  });

  it("shows cents only when they actually exist", () => {
    expect(formatUsd(2417)).toBe("$24.17");
    expect(formatUsd(1250)).toBe("$12.50");
  });

  it("groups thousands", () => {
    expect(formatUsd(1234500)).toBe("$12,345");
  });
});

describe("priceFor", () => {
  it("finds the price for each interval", () => {
    expect(priceFor(plan(), "month")?.unitAmountCents).toBe(1200);
    expect(priceFor(plan(), "year")?.unitAmountCents).toBe(12000);
  });

  it("returns undefined when a plan has no price for that interval", () => {
    expect(priceFor(plan({ prices: [price("month", 1200)] }), "year")).toBeUndefined();
  });
});

describe("isContactTier", () => {
  it("treats a contact seat model as contact-only", () => {
    expect(isContactTier(plan({ key: "enterprise", seatModel: "contact", prices: [] }))).toBe(true);
  });

  it("treats a priceless plan as contact-only even if its seat model says otherwise", () => {
    // Defensive: a tier whose Stripe prices were never seeded must render as
    // "Custom", never as "$0" — quoting free by accident is the worst
    // possible failure on a pricing page.
    expect(isContactTier(plan({ prices: [] }))).toBe(true);
  });

  it("does not treat a genuinely free plan as contact-only", () => {
    expect(isContactTier(plan({ key: "free", seatModel: "flat", prices: [price("month", 0, false)] }))).toBe(false);
  });
});

describe("monthlyEquivalentCents", () => {
  it("passes a monthly price straight through", () => {
    expect(monthlyEquivalentCents(price("month", 1200))).toBe(1200);
  });

  it("divides a yearly price down so the two columns are comparable", () => {
    expect(monthlyEquivalentCents(price("year", 12000))).toBe(1000);
  });

  it("rounds to whole cents rather than emitting a fraction", () => {
    // 29000 / 12 = 2416.66… — must not reach Intl as a fractional cent.
    expect(monthlyEquivalentCents(price("year", 29000))).toBe(2417);
  });
});

describe("monthsSavedYearly", () => {
  it("derives the discount from the real prices rather than a hardcoded claim", () => {
    // Yearly seeded at 10x monthly = two months free.
    expect(monthsSavedYearly(plan())).toBe(2);
  });

  it("returns null when there is no saving to advertise", () => {
    expect(monthsSavedYearly(plan({ prices: [price("month", 1200), price("year", 14400)] }))).toBeNull();
  });

  it("returns null for a free plan rather than dividing by zero", () => {
    expect(monthsSavedYearly(plan({ prices: [price("month", 0), price("year", 0)] }))).toBeNull();
  });

  it("returns null when either interval is missing", () => {
    expect(monthsSavedYearly(plan({ prices: [price("month", 1200)] }))).toBeNull();
  });
});
