import { BadRequestException } from "@nestjs/common";
import { assertSeatAvailable } from "./assert-seat-available";
import type { PrismaTx, TenantPrismaService } from "../tenancy/tenant-prisma.service";

function setup(params: {
  tenant?: Record<string, unknown> | null;
  plan?: { maxSeats: number | null } | null;
  activeUsers: number;
  /** userIds holding a non-billable (student) role, and — separately — those
   * among them who ALSO hold a staff role. Empty by default, which is the
   * short-circuit every pre-Student-role test exercises. */
  studentUserIds?: string[];
  alsoStaffUserIds?: string[];
}) {
  const tx = {
    user: { count: jest.fn().mockResolvedValue(params.activeUsers) },
    roleAssignment: {
      findMany: jest
        .fn()
        // First call: who holds a student role. Second: which of those are
        // also staff. Order matches countBillableUsers.
        .mockResolvedValueOnce((params.studentUserIds ?? []).map((userId) => ({ userId })))
        .mockResolvedValueOnce((params.alsoStaffUserIds ?? []).map((userId) => ({ userId }))),
    },
  } as unknown as PrismaTx;
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

/**
 * Student Role (2026-08-25) — students don't consume a paid seat.
 *
 * Purnit sells staff seats. Counting learners here would have made the Student
 * role commercially unusable the moment it shipped: a 2,000-student college is
 * not a 2,000-seat customer.
 */
describe("countBillableUsers", () => {
  it("excludes students from the seat count", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 5, // the count AFTER exclusion, which is what user.count returns
      studentUserIds: ["stu1", "stu2"],
    });
    await assertSeatAvailable(tx, tenantPrisma, "t1").catch(() => undefined);

    const countArgs = (tx as unknown as { user: { count: jest.Mock } }).user.count.mock.calls[0][0];
    expect(countArgs.where.id).toEqual({ notIn: ["stu1", "stu2"] });
  });

  it("still counts someone who holds a student role AND a staff role", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 5, planId: "p1" },
      activeUsers: 3,
      studentUserIds: ["stu1", "tutor1"],
      alsoStaffUserIds: ["tutor1"], // a student who also teaches
    });
    await assertSeatAvailable(tx, tenantPrisma, "t1").catch(() => undefined);

    const countArgs = (tx as unknown as { user: { count: jest.Mock } }).user.count.mock.calls[0][0];
    // Only the pure student is exempt — a person doing staff work pays.
    expect(countArgs.where.id).toEqual({ notIn: ["stu1"] });
  });

  it("counts every active user when the tenant has no students at all", async () => {
    const { tx, tenantPrisma } = setup({
      tenant: { id: "t1", stripeSubscriptionId: "sub_1", seatsPurchased: 10, planId: "p1" },
      activeUsers: 4,
    });
    await assertSeatAvailable(tx, tenantPrisma, "t1");

    const countArgs = (tx as unknown as { user: { count: jest.Mock } }).user.count.mock.calls[0][0];
    // No `id` filter at all — a user with NO role assignment must still pay,
    // which a naive `NOT (every …)` filter would have silently exempted since
    // `every` is vacuously true over an empty relation.
    expect(countArgs.where.id).toBeUndefined();
    expect(countArgs.where).toEqual({ tenantId: "t1", deletedAt: null });
  });
});
