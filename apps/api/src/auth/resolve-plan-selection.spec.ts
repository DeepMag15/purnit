import { resolvePlanSelection, type PlanForSelection } from "./resolve-plan-selection";

const FREE = { id: "plan_free", key: "free" };

function plan(overrides: Partial<PlanForSelection> = {}): PlanForSelection {
  return {
    id: "plan_starter",
    key: "starter",
    isPublic: true,
    seatModel: "per_seat",
    minSeats: 3,
    maxSeats: null,
    prices: [
      { interval: "month", currency: "usd", unitAmountCents: 1200, stripePriceId: "price_m" },
      { interval: "year", currency: "usd", unitAmountCents: 12000, stripePriceId: "price_y" },
    ],
    ...overrides,
  };
}

describe("resolvePlanSelection", () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  });

  describe("the pre-Phase-03 default", () => {
    it("provisions Free with one seat when no plan is requested", () => {
      expect(resolvePlanSelection({}, FREE, null)).toEqual({
        planId: "plan_free",
        planKey: "free",
        interval: null,
        seats: 1,
        subscriptionStatus: null,
        checkoutRequired: false,
      });
    });

    it("treats an explicit free request the same way, without a lookup", () => {
      expect(resolvePlanSelection({ planKey: "free", seats: 40 }, FREE, null).planKey).toBe("free");
      expect(resolvePlanSelection({ planKey: "free", seats: 40 }, FREE, null).seats).toBe(1);
    });

    it("survives a missing Free plan row rather than blocking signup", () => {
      // A reseed always recreates Free, so this shouldn't happen — but signup
      // must never hard-fail on it.
      expect(resolvePlanSelection({}, null, null).planId).toBeNull();
    });
  });

  describe("rejecting what a public endpoint must not be trusted about", () => {
    it("falls back to Free for a plan key that doesn't exist", () => {
      expect(resolvePlanSelection({ planKey: "ghost" }, FREE, null).planKey).toBe("free");
    });

    it("falls back to Free for a withdrawn tier", () => {
      // The legacy `pro` plan still serves its existing tenants but must not
      // be provisionable by anyone new.
      const legacy = plan({ key: "pro", isPublic: false });
      expect(resolvePlanSelection({ planKey: "pro" }, FREE, legacy).planKey).toBe("free");
    });

    it("falls back to Free for a contact-us tier", () => {
      // Nobody should be able to provision themselves onto Enterprise.
      const enterprise = plan({ key: "enterprise", seatModel: "contact", prices: [] });
      expect(resolvePlanSelection({ planKey: "enterprise" }, FREE, enterprise).planKey).toBe("free");
    });

    it("falls back to Free when the requested interval has no price", () => {
      const monthlyOnly = plan({ prices: [{ interval: "month", currency: "usd", unitAmountCents: 1200, stripePriceId: "price_m" }] });
      expect(resolvePlanSelection({ planKey: "starter", interval: "year" }, FREE, monthlyOnly).planKey).toBe("free");
    });

    it("never throws on an unavailable plan — signup must not hard-fail", () => {
      // The alternative (a 400 on the wizard's last step) loses the customer
      // over a stale pricing link.
      expect(() => resolvePlanSelection({ planKey: "ghost" }, FREE, null)).not.toThrow();
    });
  });

  describe("seat clamping", () => {
    it("raises a request below the plan's minimum", () => {
      expect(resolvePlanSelection({ planKey: "starter", seats: 1 }, FREE, plan()).seats).toBe(3);
    });

    it("defaults to the minimum when no seat count is sent", () => {
      expect(resolvePlanSelection({ planKey: "starter" }, FREE, plan()).seats).toBe(3);
    });

    it("keeps a request inside the allowed range", () => {
      expect(resolvePlanSelection({ planKey: "starter", seats: 25 }, FREE, plan()).seats).toBe(25);
    });

    it("caps at maxSeats so a caller can't over-provision", () => {
      const capped = plan({ minSeats: 1, maxSeats: 5 });
      expect(resolvePlanSelection({ planKey: "starter", seats: 9999 }, FREE, capped).seats).toBe(5);
    });
  });

  describe("payment state", () => {
    it("records a paid selection as pending_payment, never active", () => {
      // Only the signed Stripe webhook is trusted to write a real
      // subscription status. Signup has taken no money at this point.
      const result = resolvePlanSelection({ planKey: "starter", interval: "month", seats: 5 }, FREE, plan());
      expect(result.subscriptionStatus).toBe("pending_payment");
      expect(result.planKey).toBe("starter");
      expect(result.interval).toBe("month");
    });

    it("does not mark a $0 tier as pending payment", () => {
      const zero = plan({ prices: [{ interval: "month", currency: "usd", unitAmountCents: 0, stripePriceId: null }] });
      expect(resolvePlanSelection({ planKey: "starter" }, FREE, zero).subscriptionStatus).toBeNull();
    });

    it("requires checkout only when Stripe is configured AND the price exists", () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      expect(resolvePlanSelection({ planKey: "starter", seats: 5 }, FREE, plan()).checkoutRequired).toBe(true);
    });

    it("still provisions the chosen paid tier when Stripe is not configured", () => {
      // The whole point of the display/charge split: the workspace is created
      // on the tier the customer picked, carrying pending_payment, rather than
      // silently downgrading them because billing isn't live yet.
      delete process.env.STRIPE_SECRET_KEY;
      const result = resolvePlanSelection({ planKey: "starter", seats: 5 }, FREE, plan());
      expect(result.planKey).toBe("starter");
      expect(result.seats).toBe(5);
      expect(result.subscriptionStatus).toBe("pending_payment");
      expect(result.checkoutRequired).toBe(false);
    });

    it("does not require checkout when the tier has no Stripe price id yet", () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      const unpriced = plan({ prices: [{ interval: "month", currency: "usd", unitAmountCents: 1200, stripePriceId: null }] });
      expect(resolvePlanSelection({ planKey: "starter" }, FREE, unpriced).checkoutRequired).toBe(false);
    });
  });
});
