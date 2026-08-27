import { createBillingCapabilitiesDataSource } from "./billing.data-sources";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";

function planRow(p: {
  key: string;
  name?: string;
  maxSeats?: number | null;
  seatModel?: string;
  prices?: { interval: string; currency: string; unitAmountCents: number; stripePriceId: string | null }[];
}) {
  return {
    id: `plan_${p.key}`,
    key: p.key,
    name: p.name ?? p.key,
    tagline: null,
    highlights: [],
    seatModel: p.seatModel ?? "per_seat",
    minSeats: 1,
    maxSeats: p.maxSeats === undefined ? null : p.maxSeats,
    trialDays: 14,
    aiMessageDailyCap: null,
    sortOrder: 1,
    prices: p.prices ?? [],
  };
}

function fakeTenantPrisma(params: {
  tenant?: Record<string, unknown> | null;
  currentPlan?: ReturnType<typeof planRow> | null;
  allPlans?: ReturnType<typeof planRow>[];
  activeUsers?: number;
}) {
  return {
    root: {
      tenant: { findUnique: jest.fn().mockResolvedValue(params.tenant ?? null) },
      plan: {
        findUnique: jest.fn().mockResolvedValue(params.currentPlan ?? null),
        findMany: jest.fn().mockResolvedValue(params.allPlans ?? []),
      },
      subscriptionEvent: { findMany: jest.fn().mockResolvedValue([]) },
    },
    run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({ user: { count: jest.fn().mockResolvedValue(params.activeUsers ?? 0) } }),
    ),
  } as unknown as TenantPrismaService;
}

const UNSUBSCRIBED = {
  planId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionStatus: null,
  seatsPurchased: 1,
};

describe("billing.capabilities", () => {
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  });

  /** Shape is asserted field by field in each test below. */
  const run = async (tenantPrisma: TenantPrismaService) =>
    (await createBillingCapabilitiesDataSource(tenantPrisma).resolve({}, { tenantId: "t1" } as never, {} as never)) as any;

  it("reports no current plan when the tenant has no planId", async () => {
    const result = await run(fakeTenantPrisma({ tenant: UNSUBSCRIBED }));
    expect(result.currentPlan).toBeNull();
    expect(result.hasStripeCustomer).toBe(false);
    expect(result.hasSubscription).toBe(false);
  });

  it("resolves the current plan by the tenant's planId", async () => {
    const result = await run(
      fakeTenantPrisma({
        tenant: { ...UNSUBSCRIBED, planId: "plan_professional", stripeCustomerId: "cus_1", subscriptionStatus: "active" },
        currentPlan: planRow({ key: "professional", name: "Professional" }),
      }),
    );
    expect(result.currentPlan).toMatchObject({ key: "professional", name: "Professional" });
    expect(result.subscriptionStatus).toBe("active");
    expect(result.hasStripeCustomer).toBe(true);
  });

  it("marks a price selfServe only when it has a stripePriceId", async () => {
    const result = await run(
      fakeTenantPrisma({
        tenant: UNSUBSCRIBED,
        allPlans: [
          planRow({ key: "free", prices: [{ interval: "month", currency: "usd", unitAmountCents: 0, stripePriceId: null }] }),
          planRow({
            key: "starter",
            prices: [{ interval: "month", currency: "usd", unitAmountCents: 1200, stripePriceId: "price_starter" }],
          }),
          planRow({ key: "enterprise", seatModel: "contact", prices: [] }),
        ],
      }),
    );
    expect(result.availablePlans.map((p: { key: string; prices: { selfServe: boolean }[] }) => [p.key, p.prices[0]?.selfServe])).toEqual([
      ["free", false],
      ["starter", true],
      ["enterprise", undefined],
    ]);
  });

  it("caps an unsubscribed tenant at its plan's maxSeats, not at seatsPurchased", async () => {
    const result = await run(
      fakeTenantPrisma({
        tenant: { ...UNSUBSCRIBED, planId: "plan_free", seatsPurchased: 1 },
        currentPlan: planRow({ key: "free", maxSeats: 3 }),
        activeUsers: 2,
      }),
    );
    expect(result.seatLimit).toBe(3);
    expect(result.seatsRemaining).toBe(1);
  });

  it("caps a subscribed tenant at the seats it actually bought", async () => {
    const result = await run(
      fakeTenantPrisma({
        tenant: { ...UNSUBSCRIBED, planId: "plan_starter", stripeSubscriptionId: "sub_1", seatsPurchased: 10 },
        currentPlan: planRow({ key: "starter", maxSeats: null }),
        activeUsers: 4,
      }),
    );
    expect(result.seatLimit).toBe(10);
    expect(result.seatsRemaining).toBe(6);
    expect(result.hasSubscription).toBe(true);
  });

  // The reported limit and the enforced limit must agree. They briefly did
  // not: a pending_payment tenant was described as "unlimited" here while
  // user.invite blocked it at its selected seat count. Both now share
  // `resolveSeatLimit`, and this locks that in.
  it("reports the selected seat count for a pending_payment tenant, matching what invites enforce", async () => {
    const result = await run(
      fakeTenantPrisma({
        tenant: {
          ...UNSUBSCRIBED,
          planId: "plan_starter",
          subscriptionStatus: "pending_payment",
          seatsPurchased: 3,
        },
        // Every paid tier has maxSeats: null — the exact reason the old
        // duplicated logic reported "unlimited".
        currentPlan: planRow({ key: "starter", maxSeats: null }),
        activeUsers: 3,
      }),
    );
    expect(result.seatLimit).toBe(3);
    expect(result.seatsRemaining).toBe(0);
  });

  it("never reports negative seats remaining when a tenant is over its limit", async () => {
    const result = await run(
      fakeTenantPrisma({
        tenant: { ...UNSUBSCRIBED, planId: "plan_free" },
        currentPlan: planRow({ key: "free", maxSeats: 3 }),
        activeUsers: 8,
      }),
    );
    expect(result.seatsRemaining).toBe(0);
  });

  it("reflects StripeService.isConfigured() via stripeConfigured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const result = await run(fakeTenantPrisma({ tenant: UNSUBSCRIBED }));
    expect(result.stripeConfigured).toBe(true);
  });
});
