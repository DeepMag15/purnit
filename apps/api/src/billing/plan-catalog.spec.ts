import { clampSeats, computeTotalCents, findPrice, isBillingInterval, toPublicPlan } from "./plan-catalog";

function plan(overrides: Partial<Parameters<typeof toPublicPlan>[0]> = {}) {
  return {
    id: "plan_1",
    key: "starter",
    name: "Starter",
    tagline: "For growing teams",
    entitlements: [],
    highlights: ["Everything in Free", "Unlimited users"],
    seatModel: "per_seat",
    minSeats: 3,
    maxSeats: null,
    trialDays: 14,
    isPublic: true,
    sortOrder: 2,
    stripeProductId: null,
    aiMessageDailyCap: 500,
    prices: [
      { id: "pp_m", planId: "plan_1", interval: "month", unitAmountCents: 1200, currency: "usd", stripePriceId: "price_m" },
      { id: "pp_y", planId: "plan_1", interval: "year", unitAmountCents: 12000, currency: "usd", stripePriceId: null },
    ],
    ...overrides,
  } as Parameters<typeof toPublicPlan>[0];
}

describe("isBillingInterval", () => {
  it("accepts only the two real intervals", () => {
    expect(isBillingInterval("month")).toBe(true);
    expect(isBillingInterval("year")).toBe(true);
    expect(isBillingInterval("week")).toBe(false);
  });
});

describe("toPublicPlan", () => {
  it("exposes the pricing-card fields and marks selfServe per price", () => {
    const result = toPublicPlan(plan());
    expect(result).toMatchObject({ key: "starter", name: "Starter", minSeats: 3, trialDays: 14 });
    expect(result.prices).toEqual([
      { interval: "month", unitAmountCents: 1200, currency: "usd", selfServe: true },
      // No Stripe price id yet — the price still displays, it just can't be charged.
      { interval: "year", unitAmountCents: 12000, currency: "usd", selfServe: false },
    ]);
  });

  it("always orders month before year regardless of row order", () => {
    const reversed = plan({
      prices: [
        { id: "pp_y", planId: "plan_1", interval: "year", unitAmountCents: 12000, currency: "usd", stripePriceId: null },
        { id: "pp_m", planId: "plan_1", interval: "month", unitAmountCents: 1200, currency: "usd", stripePriceId: "price_m" },
      ],
    } as never);
    expect(toPublicPlan(reversed).prices.map((p) => p.interval)).toEqual(["month", "year"]);
  });

  it("drops a price row with an unrecognized interval rather than surfacing it", () => {
    const weird = plan({
      prices: [{ id: "pp_w", planId: "plan_1", interval: "week", unitAmountCents: 300, currency: "usd", stripePriceId: null }],
    } as never);
    expect(toPublicPlan(weird).prices).toEqual([]);
  });

  it("survives a malformed highlights bag rather than crashing a public endpoint", () => {
    expect(toPublicPlan(plan({ highlights: "not an array" } as never)).highlights).toEqual([]);
    expect(toPublicPlan(plan({ highlights: ["ok", 42, null] } as never)).highlights).toEqual(["ok"]);
  });
});

describe("clampSeats", () => {
  it("raises a request below the plan's minimum", () => {
    expect(clampSeats(plan(), 1)).toBe(3);
  });

  it("leaves a request inside the range alone", () => {
    expect(clampSeats(plan(), 7)).toBe(7);
  });

  it("caps at maxSeats when the plan has one", () => {
    expect(clampSeats(plan({ minSeats: 1, maxSeats: 3 }), 9)).toBe(3);
  });

  it("clamps rather than throwing on hostile or nonsense input", () => {
    // This runs on unauthenticated input (a pricing-page query param), where
    // a bad value must produce a sane price, not a 500.
    expect(clampSeats(plan(), Number.NaN)).toBe(3);
    expect(clampSeats(plan(), -20)).toBe(3);
    expect(clampSeats(plan(), 4.8)).toBe(4);
  });
});

describe("computeTotalCents", () => {
  it("multiplies by seats on a per-seat plan", () => {
    expect(computeTotalCents(plan(), "month", 5)).toBe(6000);
  });

  it("ignores seat count entirely on a flat plan", () => {
    const free = plan({ seatModel: "flat", minSeats: 1, prices: [{ id: "p", planId: "plan_1", interval: "month", unitAmountCents: 0, currency: "usd", stripePriceId: null }] } as never);
    expect(computeTotalCents(free, "month", 50)).toBe(0);
  });

  it("applies the plan's seat minimum to the total, so the quote matches what Stripe will charge", () => {
    // Asking for 1 seat on a 3-seat-minimum plan must quote 3 seats, not 1 —
    // otherwise the wizard shows a price the Checkout session won't honour.
    expect(computeTotalCents(plan(), "month", 1)).toBe(3600);
  });

  it("uses the yearly unit price, which already carries the discount", () => {
    // 10x monthly, not 12x — two months free, expressed in the price itself.
    expect(computeTotalCents(plan(), "year", 3)).toBe(36000);
  });

  it("returns 0 for an interval the plan has no price for", () => {
    const monthlyOnly = plan({
      prices: [{ id: "pp_m", planId: "plan_1", interval: "month", unitAmountCents: 1200, currency: "usd", stripePriceId: "price_m" }],
    } as never);
    expect(computeTotalCents(monthlyOnly, "year", 3)).toBe(0);
  });
});

describe("findPrice", () => {
  it("matches on interval and usd currency", () => {
    expect(findPrice(plan(), "month")?.unitAmountCents).toBe(1200);
    expect(findPrice(plan(), "year")?.unitAmountCents).toBe(12000);
  });
});
