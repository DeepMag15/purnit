import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  createCancelSubscriptionMutation,
  createChangePlanMutation,
  createCreateCheckoutSessionMutation,
  createCreatePortalSessionMutation,
  createResumeSubscriptionMutation,
  createUpdateSeatsMutation,
} from "./billing.mutations";
import type { StripeService } from "./stripe.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";

function fakeStripe(overrides: Partial<Record<keyof StripeService, unknown>> = {}) {
  return {
    createOrGetCustomer: jest.fn().mockResolvedValue("cus_new"),
    createCheckoutSession: jest.fn().mockResolvedValue({ url: "https://checkout.stripe.com/xyz" }),
    createPortalSession: jest.fn().mockResolvedValue({ url: "https://billing.stripe.com/xyz" }),
    updateSubscription: jest.fn().mockResolvedValue({}),
    scheduleChangeAtPeriodEnd: jest.fn().mockResolvedValue({}),
    releaseScheduleForSubscription: jest.fn().mockResolvedValue(undefined),
    cancelSubscriptionAtPeriodEnd: jest.fn().mockResolvedValue({}),
    resumeSubscription: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as StripeService;
}

type FakePlan = {
  id?: string;
  key: string;
  name?: string;
  seatModel?: string;
  minSeats?: number;
  maxSeats?: number | null;
  trialDays?: number;
  sortOrder?: number;
  prices?: { interval: string; currency: string; unitAmountCents: number; stripePriceId: string | null }[];
};

function plan(p: FakePlan) {
  return {
    id: p.id ?? `plan_${p.key}`,
    key: p.key,
    name: p.name ?? p.key,
    seatModel: p.seatModel ?? "per_seat",
    minSeats: p.minSeats ?? 1,
    maxSeats: p.maxSeats === undefined ? null : p.maxSeats,
    trialDays: p.trialDays ?? 14,
    sortOrder: p.sortOrder ?? 1,
    prices: p.prices ?? [{ interval: "month", currency: "usd", unitAmountCents: 1200, stripePriceId: "price_1" }],
  };
}

function fakeTenantPrisma(params: {
  /** Looked up by `key` (checkout/changePlan) or by `id` (current plan). */
  plansByKey?: Record<string, ReturnType<typeof plan> | null>;
  plansById?: Record<string, ReturnType<typeof plan> | null>;
  tenant?: Record<string, unknown> | null;
  activeUsers?: number;
}) {
  const tenantUpdate = jest.fn().mockResolvedValue({});
  const eventCreate = jest.fn().mockResolvedValue({});
  return {
    root: {
      plan: {
        findUnique: jest.fn(({ where }: { where: { key?: string; id?: string } }) =>
          Promise.resolve(where.key ? (params.plansByKey?.[where.key] ?? null) : (params.plansById?.[where.id!] ?? null)),
        ),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(params.tenant ?? null),
        update: tenantUpdate,
      },
      subscriptionEvent: { create: eventCreate },
    },
    run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({
        user: {
          findFirst: jest.fn().mockResolvedValue({ email: "a@b.com" }),
          count: jest.fn().mockResolvedValue(params.activeUsers ?? 0),
        },
      }),
    ),
  } as unknown as TenantPrismaService;
}

const CTX = { tenantId: "t1", authUserId: "au1" };
const TENANT = { id: "t1", name: "Acme", stripeCustomerId: null, stripeSubscriptionId: null, seatsPurchased: 1 };

describe("billing.createCheckoutSession", () => {
  it("400s when the plan has no self-serve price for the chosen interval (Enterprise)", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { enterprise: plan({ key: "enterprise", seatModel: "contact", prices: [] }) },
    });
    const mutation = createCreateCheckoutSessionMutation(fakeStripe(), tenantPrisma);
    await expect(mutation.preResolve!({ planKey: "enterprise", interval: "month", seats: 1 }, CTX)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("400s when the tier is self-serve but that interval has no Stripe price configured yet", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: {
        starter: plan({ key: "starter", prices: [{ interval: "year", currency: "usd", unitAmountCents: 12000, stripePriceId: null }] }),
      },
    });
    const mutation = createCreateCheckoutSessionMutation(fakeStripe(), tenantPrisma);
    await expect(mutation.preResolve!({ planKey: "starter", interval: "year", seats: 3 }, CTX)).rejects.toThrow(BadRequestException);
  });

  it("404s when the plan key doesn't exist at all", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansByKey: {} });
    const mutation = createCreateCheckoutSessionMutation(fakeStripe(), tenantPrisma);
    await expect(mutation.preResolve!({ planKey: "ghost", interval: "month", seats: 1 }, CTX)).rejects.toThrow();
  });

  it("creates a new Stripe customer and persists it when the tenant has none yet", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansByKey: { starter: plan({ key: "starter" }) }, tenant: TENANT });
    const stripe = fakeStripe();
    const mutation = createCreateCheckoutSessionMutation(stripe, tenantPrisma);

    const result = await mutation.preResolve!({ planKey: "starter", interval: "month", seats: 3 }, CTX);

    expect(result).toEqual({ url: "https://checkout.stripe.com/xyz" });
    expect(tenantPrisma.root.tenant.update as jest.Mock).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { stripeCustomerId: "cus_new" },
    });
  });

  it("reuses an existing Stripe customer without a redundant tenant.update", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { starter: plan({ key: "starter" }) },
      tenant: { ...TENANT, stripeCustomerId: "cus_existing" },
    });
    const stripe = fakeStripe({ createOrGetCustomer: jest.fn().mockResolvedValue("cus_existing") });
    const mutation = createCreateCheckoutSessionMutation(stripe, tenantPrisma);

    await mutation.preResolve!({ planKey: "starter", interval: "month", seats: 3 }, CTX);

    expect(tenantPrisma.root.tenant.update).not.toHaveBeenCalled();
  });

  it("passes the seat count to Stripe as the subscription quantity", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansByKey: { starter: plan({ key: "starter", minSeats: 3 }) }, tenant: TENANT });
    const stripe = fakeStripe();
    const mutation = createCreateCheckoutSessionMutation(stripe, tenantPrisma);

    await mutation.preResolve!({ planKey: "starter", interval: "month", seats: 7 }, CTX);

    expect((stripe.createCheckoutSession as jest.Mock).mock.calls[0][0]).toMatchObject({ seats: 7, interval: "month" });
  });

  it("raises seats to the plan's minimum when the caller asks for fewer", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansByKey: { starter: plan({ key: "starter", minSeats: 5 }) }, tenant: TENANT });
    const stripe = fakeStripe();
    const mutation = createCreateCheckoutSessionMutation(stripe, tenantPrisma);

    await mutation.preResolve!({ planKey: "starter", interval: "month", seats: 1 }, CTX);

    expect((stripe.createCheckoutSession as jest.Mock).mock.calls[0][0].seats).toBe(5);
  });

  it("never bills for fewer seats than the workspace already has people", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { starter: plan({ key: "starter", minSeats: 1 }) },
      tenant: TENANT,
      activeUsers: 8,
    });
    const stripe = fakeStripe();
    const mutation = createCreateCheckoutSessionMutation(stripe, tenantPrisma);

    await mutation.preResolve!({ planKey: "starter", interval: "month", seats: 3 }, CTX);

    expect((stripe.createCheckoutSession as jest.Mock).mock.calls[0][0].seats).toBe(8);
  });

  it("grants the trial on a first subscription but not to a tenant already subscribed", async () => {
    const stripeFirst = fakeStripe();
    await createCreateCheckoutSessionMutation(
      stripeFirst,
      fakeTenantPrisma({ plansByKey: { starter: plan({ key: "starter", trialDays: 14 }) }, tenant: TENANT }),
    ).preResolve!({ planKey: "starter", interval: "month", seats: 3 }, CTX);
    expect((stripeFirst.createCheckoutSession as jest.Mock).mock.calls[0][0].trialDays).toBe(14);

    const stripeAgain = fakeStripe();
    await createCreateCheckoutSessionMutation(
      stripeAgain,
      fakeTenantPrisma({
        plansByKey: { starter: plan({ key: "starter", trialDays: 14 }) },
        tenant: { ...TENANT, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" },
      }),
    ).preResolve!({ planKey: "starter", interval: "month", seats: 3 }, CTX);
    expect((stripeAgain.createCheckoutSession as jest.Mock).mock.calls[0][0].trialDays).toBe(0);
  });

  it("resolve() never writes to tx — it only passes preResolve's result through", async () => {
    const tenantPrisma = fakeTenantPrisma({});
    const mutation = createCreateCheckoutSessionMutation(fakeStripe(), tenantPrisma);
    const result = await mutation.resolve({ planKey: "starter", interval: "month", seats: 1 }, {} as never, {} as never, {
      url: "https://checkout.stripe.com/xyz",
    });
    expect(result).toEqual({ url: "https://checkout.stripe.com/xyz" });
  });
});

describe("billing.createPortalSession", () => {
  it("400s when the tenant has never checked out (no stripeCustomerId)", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: TENANT });
    const mutation = createCreatePortalSessionMutation(fakeStripe(), tenantPrisma);
    await expect(mutation.preResolve!({}, CTX)).rejects.toThrow(BadRequestException);
  });

  it("returns the Stripe-hosted portal URL when a customer exists", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: { ...TENANT, stripeCustomerId: "cus_existing" } });
    const mutation = createCreatePortalSessionMutation(fakeStripe(), tenantPrisma);
    expect(await mutation.preResolve!({}, CTX)).toEqual({ url: "https://billing.stripe.com/xyz" });
  });
});

describe("billing.changePlan", () => {
  const SUBSCRIBED = { ...TENANT, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, billingInterval: "month" };
  const starter = plan({ key: "starter", sortOrder: 2 });
  const professional = plan({ key: "professional", sortOrder: 3, prices: [{ interval: "month", currency: "usd", unitAmountCents: 2900, stripePriceId: "price_pro" }] });

  it("400s when the tenant has no subscription to change", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansByKey: { professional }, tenant: TENANT });
    const mutation = createChangePlanMutation(fakeStripe(), tenantPrisma);
    await expect(mutation.preResolve!({ planKey: "professional", interval: "month" }, CTX)).rejects.toThrow(BadRequestException);
  });

  it("409s when already on that exact plan and interval", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { starter },
      plansById: { [starter.id]: starter },
      tenant: { ...SUBSCRIBED, planId: starter.id },
    });
    const mutation = createChangePlanMutation(fakeStripe(), tenantPrisma);
    await expect(mutation.preResolve!({ planKey: "starter", interval: "month" }, CTX)).rejects.toThrow(ConflictException);
  });

  it("upgrades immediately and bills the prorated difference", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { professional },
      plansById: { [starter.id]: starter },
      tenant: { ...SUBSCRIBED, planId: starter.id },
    });
    const stripe = fakeStripe();
    const result = await createChangePlanMutation(stripe, tenantPrisma).preResolve!({ planKey: "professional", interval: "month" }, CTX);

    expect(result.scheduled).toBe(false);
    expect((stripe.updateSubscription as jest.Mock).mock.calls[0][0]).toMatchObject({
      subscriptionId: "sub_1",
      priceId: "price_pro",
      seats: 5,
      prorationBehavior: "always_invoice",
    });
    expect(stripe.scheduleChangeAtPeriodEnd).not.toHaveBeenCalled();
  });

  it("schedules a downgrade for period end instead of applying it now", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { starter },
      plansById: { [professional.id]: professional },
      tenant: { ...SUBSCRIBED, planId: professional.id },
    });
    const stripe = fakeStripe();
    const result = await createChangePlanMutation(stripe, tenantPrisma).preResolve!({ planKey: "starter", interval: "month" }, CTX);

    expect(result.scheduled).toBe(true);
    expect(stripe.scheduleChangeAtPeriodEnd).toHaveBeenCalled();
    expect(stripe.updateSubscription).not.toHaveBeenCalled();
  });

  it("releases a pending downgrade before applying an upgrade, so it can't undo it later", async () => {
    const tenantPrisma = fakeTenantPrisma({
      plansByKey: { professional },
      plansById: { [starter.id]: starter },
      tenant: { ...SUBSCRIBED, planId: starter.id, pendingPlanKey: "free" },
    });
    const stripe = fakeStripe();
    await createChangePlanMutation(stripe, tenantPrisma).preResolve!({ planKey: "professional", interval: "month" }, CTX);

    expect(stripe.releaseScheduleForSubscription).toHaveBeenCalledWith("sub_1");
  });
});

describe("billing.updateSeats", () => {
  const starter = plan({ key: "starter", minSeats: 1 });
  const SUBSCRIBED = {
    ...TENANT,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    seatsPurchased: 5,
    planId: starter.id,
  };

  it("409s when the seat count is unchanged", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansById: { [starter.id]: starter }, tenant: SUBSCRIBED, activeUsers: 3 });
    await expect(createUpdateSeatsMutation(fakeStripe(), tenantPrisma).preResolve!({ seats: 5 }, CTX)).rejects.toThrow(ConflictException);
  });

  it("refuses to drop below the number of people already in the workspace", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansById: { [starter.id]: starter }, tenant: SUBSCRIBED, activeUsers: 4 });
    await expect(createUpdateSeatsMutation(fakeStripe(), tenantPrisma).preResolve!({ seats: 2 }, CTX)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("adds seats immediately, prorated", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansById: { [starter.id]: starter }, tenant: SUBSCRIBED, activeUsers: 5 });
    const stripe = fakeStripe();
    const result = await createUpdateSeatsMutation(stripe, tenantPrisma).preResolve!({ seats: 9 }, CTX);

    expect(result).toEqual({ seats: 9, immediate: true });
    expect((stripe.updateSubscription as jest.Mock).mock.calls[0][0]).toMatchObject({ seats: 9, prorationBehavior: "always_invoice" });
  });

  it("removes seats without issuing a credit", async () => {
    const tenantPrisma = fakeTenantPrisma({ plansById: { [starter.id]: starter }, tenant: SUBSCRIBED, activeUsers: 2 });
    const stripe = fakeStripe();
    const result = await createUpdateSeatsMutation(stripe, tenantPrisma).preResolve!({ seats: 3 }, CTX);

    expect(result).toEqual({ seats: 3, immediate: false });
    expect((stripe.updateSubscription as jest.Mock).mock.calls[0][0]).toMatchObject({ seats: 3, prorationBehavior: "none" });
  });
});

describe("billing.cancelSubscription / resumeSubscription", () => {
  const SUBSCRIBED = { ...TENANT, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", cancelAtPeriodEnd: false, currentPeriodEnd: null };

  it("cancels at period end rather than immediately", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: SUBSCRIBED });
    const stripe = fakeStripe();
    await createCancelSubscriptionMutation(stripe, tenantPrisma).preResolve!({}, CTX);
    expect(stripe.cancelSubscriptionAtPeriodEnd).toHaveBeenCalledWith("sub_1");
  });

  it("409s when a cancellation is already pending", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: { ...SUBSCRIBED, cancelAtPeriodEnd: true } });
    await expect(createCancelSubscriptionMutation(fakeStripe(), tenantPrisma).preResolve!({}, CTX)).rejects.toThrow(ConflictException);
  });

  it("409s when resuming something that isn't scheduled to cancel", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: SUBSCRIBED });
    await expect(createResumeSubscriptionMutation(fakeStripe(), tenantPrisma).preResolve!({}, CTX)).rejects.toThrow(ConflictException);
  });

  it("resumes a pending cancellation", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: { ...SUBSCRIBED, cancelAtPeriodEnd: true } });
    const stripe = fakeStripe();
    await createResumeSubscriptionMutation(stripe, tenantPrisma).preResolve!({}, CTX);
    expect(stripe.resumeSubscription).toHaveBeenCalledWith("sub_1");
  });
});
