import { StripeService } from "./stripe.service";

const mockConstructEvent = jest.fn();
const mockCustomersCreate = jest.fn();
const mockCheckoutSessionsCreate = jest.fn();
const mockPortalSessionsCreate = jest.fn();

// Jest hoists jest.mock() calls above imports in the same file (ts-jest
// implements the same hoisting babel-jest does), so this takes effect before
// stripe.service.ts's own `import Stripe from "stripe"` resolves.
jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockCheckoutSessionsCreate } },
    billingPortal: { sessions: { create: mockPortalSessionsCreate } },
    webhooks: { constructEvent: mockConstructEvent },
  }));
});

describe("StripeService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_fake";
  });

  describe("isConfigured", () => {
    it("is false with no STRIPE_SECRET_KEY", () => {
      delete process.env.STRIPE_SECRET_KEY;
      expect(StripeService.isConfigured()).toBe(false);
    });

    it("is true once STRIPE_SECRET_KEY is set", () => {
      expect(StripeService.isConfigured()).toBe(true);
    });
  });

  describe("lazy client construction", () => {
    it("constructing the service never throws even with no key configured — deferred to first real use", () => {
      delete process.env.STRIPE_SECRET_KEY;
      expect(() => new StripeService()).not.toThrow();
    });

    it("a real call with no key configured throws a clear, addressable error", async () => {
      delete process.env.STRIPE_SECRET_KEY;
      const service = new StripeService();
      await expect(service.createOrGetCustomer("t1", null, "a@b.com", "Acme")).rejects.toThrow(/not configured/);
    });
  });

  describe("createOrGetCustomer", () => {
    it("returns the existing customer id without calling Stripe when one is already given", async () => {
      const service = new StripeService();
      const result = await service.createOrGetCustomer("t1", "cus_existing", "a@b.com", "Acme");
      expect(result).toBe("cus_existing");
      expect(mockCustomersCreate).not.toHaveBeenCalled();
    });

    it("creates a new Stripe customer, tagged with tenantId, when none exists yet", async () => {
      mockCustomersCreate.mockResolvedValue({ id: "cus_new" });
      const service = new StripeService();
      const result = await service.createOrGetCustomer("t1", null, "a@b.com", "Acme");
      expect(result).toBe("cus_new");
      expect(mockCustomersCreate).toHaveBeenCalledWith({ email: "a@b.com", name: "Acme", metadata: { tenantId: "t1" } });
    });
  });

  describe("createCheckoutSession", () => {
    const baseParams = {
      customerId: "cus_1",
      priceId: "price_1",
      tenantId: "t1",
      planKey: "starter",
      seats: 5,
      interval: "month",
      trialDays: 14,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    };

    it("creates a subscription-mode session carrying tenantId, planKey, seats and interval", async () => {
      mockCheckoutSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/xyz" });
      const service = new StripeService();
      const session = await service.createCheckoutSession(baseParams);
      expect(session.url).toBe("https://checkout.stripe.com/xyz");
      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith({
        customer: "cus_1",
        client_reference_id: "t1",
        // seats/interval ride in metadata so the webhook can read them back
        // without trusting anything the browser sends on the redirect.
        metadata: { planKey: "starter", seats: "5", interval: "month" },
        mode: "subscription",
        line_items: [{ price: "price_1", quantity: 5 }],
        subscription_data: { trial_period_days: 14, metadata: { tenantId: "t1" } },
        success_url: "https://app/success",
        cancel_url: "https://app/cancel",
      });
    });

    it("omits trial_period_days entirely when there is no trial", async () => {
      mockCheckoutSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/xyz" });
      const service = new StripeService();
      await service.createCheckoutSession({ ...baseParams, trialDays: 0 });
      // Passing `trial_period_days: 0` is NOT the same as passing nothing —
      // Stripe rejects 0 as out of range.
      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ subscription_data: { metadata: { tenantId: "t1" } } }),
      );
    });

    it("uses the seat count as the line item quantity", async () => {
      mockCheckoutSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/xyz" });
      const service = new StripeService();
      await service.createCheckoutSession({ ...baseParams, seats: 23 });
      expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [{ price: "price_1", quantity: 23 }] }),
      );
    });
  });

  describe("constructWebhookEvent", () => {
    it("delegates to stripe.webhooks.constructEvent with the configured secret", () => {
      mockConstructEvent.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
      const service = new StripeService();
      const buf = Buffer.from("{}");
      const event = service.constructWebhookEvent(buf, "sig_123");
      expect(event).toEqual({ id: "evt_1", type: "checkout.session.completed" });
      expect(mockConstructEvent).toHaveBeenCalledWith(buf, "sig_123", "whsec_fake");
    });

    it("rethrows on an invalid signature — this is the endpoint's only authentication", () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature for payload");
      });
      const service = new StripeService();
      expect(() => service.constructWebhookEvent(Buffer.from("{}"), "bad_sig")).toThrow(/signature/);
    });
  });
});
