import { BadRequestException } from "@nestjs/common";
import { assertSeatAvailable } from "./assert-seat-available";
import type { PrismaTx, TenantPrismaService } from "../tenancy/tenant-prisma.service";

function setup(params: {
  tenant?: Record<string, unknown> | null;
  plan?: { maxSeats: number | null } | null;
  activeUsers: number;
}) {
  const tx = { user: { count: jest.fn().mockResolvedValue(params.activeUsers) } } as unknown as PrismaTx;
  const tenantPrisma = {
    root: {
      tenant: { findUnique: jest.fn().mockResolvedValue(params.tenant ?? null) },
      plan: { findUnique: jest.fn().mockResolvedValue(params.plan ?? null) },
    },
  } as unknown as TenantPrismaService;
  return { tx, tenantPrisma };
}

describe("assertSeatAvailable", () => {
  it("allows an invite when a paid tenant has seats to spare", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 10, planId: "p1" },
      activeUsers: 4,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).resolves.toBeUndefined();
  });

  it("blocks a paid tenant at exactly its purchased seat count", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 5,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).rejects.toThrow(BadRequestException);
  });

  it("tells a paying customer to add seats, not to upgrade", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 5,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).rejects.toThrow(/Add seats/);
  });

  it("caps an unsubscribed tenant by its plan's maxSeats", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: null, seatsPurchased: 1, planId: "p_free" },
      plan: { maxSeats: 3 },
      activeUsers: 3,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).rejects.toThrow(/Upgrade/);
  });

  it("ignores seatsPurchased for an unsubscribed tenant", async () => {
    // seatsPurchased is meaningless without a subscription — a stale value
    // must not become a limit, in either direction.
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: null, seatsPurchased: 99, planId: "p_free" },
      plan: { maxSeats: 3 },
      activeUsers: 3,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).rejects.toThrow(BadRequestException);
  });

  // Found during Phase 03's live verification, not by a unit test: a tenant
  // that picked a paid tier at signup and never paid has no Stripe
  // subscription, so it used to fall through to `plan.maxSeats` — null on
  // every paid tier — and got unlimited seats for free.
  it("holds a pending_payment tenant to the seats it selected at signup", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: null, subscriptionStatus: "pending_payment", seatsPurchased: 7, planId: "p_starter" },
      plan: { maxSeats: null },
      activeUsers: 7,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).rejects.toThrow(/All 7 seats are in use/);
  });

  it("still allows a pending_payment tenant room inside its selected seats", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: null, subscriptionStatus: "pending_payment", seatsPurchased: 7, planId: "p_starter" },
      plan: { maxSeats: null },
      activeUsers: 3,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).resolves.toBeUndefined();
  });

  it("leaves a plan with no maxSeats uncapped", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: null, seatsPurchased: 1, planId: "p_ent" },
      plan: { maxSeats: null },
      activeUsers: 500,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).resolves.toBeUndefined();
  });

  it("leaves a tenant with no plan at all uncapped", async () => {
    // `planId: null` is the Phase-1 "everything entitled" default and has
    // never implied a seat cap — inventing one here would suddenly block
    // existing tenants that predate billing.
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: null, seatsPurchased: 1, planId: null },
      activeUsers: 40,
    });
    await expect(assertSeatAvailable(tx, tenantPrisma, "t1")).resolves.toBeUndefined();
  });

  it("does nothing when the tenant row is missing rather than blocking", async () => {
    const { tx, tenantPrisma } = setup({ tenant: null, activeUsers: 0 });
    await expect(assertSeatAvailable(tx, tenantPrisma, "gone")).resolves.toBeUndefined();
  });

  it("counts only non-deleted users, so removing someone frees their seat", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 4,
    });
    await assertSeatAvailable(tx, tenantPrisma, "t1");
    expect((tx.user.count as jest.Mock)).toHaveBeenCalledWith({ where: { tenantId: "t1", deletedAt: null } });
  });
});
