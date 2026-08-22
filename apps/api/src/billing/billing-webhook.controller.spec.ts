import { BadRequestException } from "@nestjs/common";
import { BillingWebhookController } from "./billing-webhook.controller";
import type { StripeService } from "./stripe.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import { Prisma } from "../generated/prisma/client";

function fakeReq(rawBody: Buffer | undefined) {
  return { rawBody } as never;
}

function fakeStripe(constructEvent: jest.Mock, overrides: Record<string, unknown> = {}) {
  return { constructWebhookEvent: constructEvent, getSubscription: jest.fn(), ...overrides } as unknown as StripeService;
}

/** A Stripe subscription as this integration reads it. `current_period_end`
 * and `quantity` live on the subscription ITEM in the current API version —
 * verified against the SDK's own type definitions — so the fixture mirrors
 * that shape rather than the older top-level one. */
function subscription(params: {
  status?: string;
  customer?: string;
  periodEndSeconds?: number;
  quantity?: number;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: number | null;
}) {
  return {
    id: "sub_1",
    customer: params.customer ?? "cus_1",
    status: params.status ?? "active",
    cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
    trial_end: params.trialEnd ?? null,
    items: {
      data: [
        {
          id: "si_1",
          quantity: params.quantity ?? 5,
          current_period_end: params.periodEndSeconds ?? 1_800_000_000,
          price: { id: params.priceId ?? "price_starter_m" },
        },
      ],
    },
  };
}

function fakeTenantPrisma(params: {
  stripeEventCreate?: jest.Mock;
  tenant?: Record<string, unknown> | null;
  plan?: Record<string, unknown> | null;
  planPrice?: Record<string, unknown> | null;
  notificationCreateMany?: jest.Mock;
  roleFindFirst?: unknown;
  roleAssignmentFindMany?: unknown[];
}) {
  const tenantUpdate = jest.fn().mockResolvedValue({});
  const stripeEventCreate = params.stripeEventCreate ?? jest.fn().mockResolvedValue({});
  const notificationCreateMany = params.notificationCreateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const subscriptionEventCreate = jest.fn().mockResolvedValue({});
  return {
    root: {
      stripeEvent: { create: stripeEventCreate },
      tenant: {
        findUnique: jest.fn().mockResolvedValue(params.tenant ?? null),
        update: tenantUpdate,
      },
      plan: { findUnique: jest.fn().mockResolvedValue(params.plan ?? null) },
      planPrice: { findFirst: jest.fn().mockResolvedValue(params.planPrice ?? null) },
      subscriptionEvent: { create: subscriptionEventCreate },
    },
    run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({
        role: { findFirst: jest.fn().mockResolvedValue(params.roleFindFirst ?? { id: "role-admin-1" }) },
        roleAssignment: { findMany: jest.fn().mockResolvedValue(params.roleAssignmentFindMany ?? [{ userId: "admin-1" }]) },
        notification: { createMany: notificationCreateMany },
      }),
    ),
    _tenantUpdate: tenantUpdate,
    _notificationCreateMany: notificationCreateMany,
    _subscriptionEventCreate: subscriptionEventCreate,
  } as unknown as TenantPrismaService & {
    _tenantUpdate: jest.Mock;
    _notificationCreateMany: jest.Mock;
    _subscriptionEventCreate: jest.Mock;
  };
}

describe("BillingWebhookController", () => {
  it("400s when the raw body is missing", async () => {
    const controller = new BillingWebhookController(fakeStripe(jest.fn()), fakeTenantPrisma({}));
    await expect(controller.handle(fakeReq(undefined), "sig")).rejects.toThrow(BadRequestException);
  });

  it("400s when the signature header is missing", async () => {
    const controller = new BillingWebhookController(fakeStripe(jest.fn()), fakeTenantPrisma({}));
    await expect(controller.handle(fakeReq(Buffer.from("{}")), undefined)).rejects.toThrow(BadRequestException);
  });

  it("400s when Stripe's own signature verification throws — this is the endpoint's only authentication", async () => {
    const constructEvent = jest.fn().mockImplementation(() => {
      throw new Error("bad signature");
    });
    const controller = new BillingWebhookController(fakeStripe(constructEvent), fakeTenantPrisma({}));
    await expect(controller.handle(fakeReq(Buffer.from("{}")), "sig")).rejects.toThrow(BadRequestException);
  });

  it("idempotency: a duplicate event id (unique-constraint violation) is a no-op, not reprocessed", async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    const stripeEventCreate = jest.fn().mockRejectedValue(duplicateError);
    const tenantPrisma = fakeTenantPrisma({ stripeEventCreate });
    const constructEvent = jest.fn().mockReturnValue({ id: "evt_dup", type: "checkout.session.completed", data: { object: {} } });
    const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

    const result = await controller.handle(fakeReq(Buffer.from("{}")), "sig");

    expect(result).toEqual({ received: true, duplicate: true });
    expect(tenantPrisma._tenantUpdate).not.toHaveBeenCalled();
  });

  describe("checkout.session.completed", () => {
    const session = {
      id: "cs_1",
      client_reference_id: "t1",
      metadata: { planKey: "starter", seats: "7", interval: "month" },
      customer: "cus_1",
      subscription: "sub_1",
    };

    it("writes the plan, seats and interval taken from OUR metadata, not the browser", async () => {
      const tenantPrisma = fakeTenantPrisma({
        plan: { id: "plan-starter", key: "starter", name: "Starter" },
        tenant: { id: "t1", seatsPurchased: 1 },
      });
      const constructEvent = jest.fn().mockReturnValue({ id: "evt_1", type: "checkout.session.completed", data: { object: session } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(tenantPrisma._tenantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "t1" },
          data: expect.objectContaining({
            planId: "plan-starter",
            stripeCustomerId: "cus_1",
            stripeSubscriptionId: "sub_1",
            seatsPurchased: 7,
            billingInterval: "month",
          }),
        }),
      );
      expect(tenantPrisma._notificationCreateMany).toHaveBeenCalled();
    });

    it("records the real Stripe status rather than assuming 'active' — a trial means 'trialing'", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      const tenantPrisma = fakeTenantPrisma({
        plan: { id: "plan-starter", key: "starter", name: "Starter" },
        tenant: { id: "t1", seatsPurchased: 1 },
      });
      const getSubscription = jest.fn().mockResolvedValue(subscription({ status: "trialing", trialEnd: 1_700_000_000 }));
      const constructEvent = jest.fn().mockReturnValue({ id: "evt_1b", type: "checkout.session.completed", data: { object: session } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent, { getSubscription }), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      const data = (tenantPrisma._tenantUpdate as jest.Mock).mock.calls[0][0].data;
      expect(data.subscriptionStatus).toBe("trialing");
      expect(data.trialEndsAt).toEqual(new Date(1_700_000_000 * 1000));
      delete process.env.STRIPE_SECRET_KEY;
    });

    it("still completes when the enrichment call to Stripe fails — the core write must not be lost to a retry loop", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_fake";
      const tenantPrisma = fakeTenantPrisma({
        plan: { id: "plan-starter", key: "starter", name: "Starter" },
        tenant: { id: "t1", seatsPurchased: 1 },
      });
      const getSubscription = jest.fn().mockRejectedValue(new Error("stripe down"));
      const constructEvent = jest.fn().mockReturnValue({ id: "evt_1c", type: "checkout.session.completed", data: { object: session } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent, { getSubscription }), tenantPrisma);

      const result = await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(result).toEqual({ received: true });
      expect(tenantPrisma._tenantUpdate).toHaveBeenCalled();
      delete process.env.STRIPE_SECRET_KEY;
    });

    it("logs and skips silently when client_reference_id is missing", async () => {
      const tenantPrisma = fakeTenantPrisma({});
      const bad = { id: "cs_2", client_reference_id: null, metadata: {}, customer: "cus_1" };
      const constructEvent = jest.fn().mockReturnValue({ id: "evt_2", type: "checkout.session.completed", data: { object: bad } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      const result = await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(result).toEqual({ received: true });
      expect(tenantPrisma._tenantUpdate).not.toHaveBeenCalled();
    });
  });

  describe("customer.subscription.updated", () => {
    it("reads period end and seats off the subscription ITEM, where Stripe actually puts them", async () => {
      const tenantPrisma = fakeTenantPrisma({
        tenant: { id: "t1", stripeCustomerId: "cus_1", seatsPurchased: 5, planId: "plan-starter", pendingPlanKey: null },
      });
      const constructEvent = jest.fn().mockReturnValue({
        id: "evt_3",
        type: "customer.subscription.updated",
        data: { object: subscription({ status: "past_due", quantity: 9, periodEndSeconds: 1_800_000_000 }) },
      });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      const data = (tenantPrisma._tenantUpdate as jest.Mock).mock.calls[0][0].data;
      expect(data.subscriptionStatus).toBe("past_due");
      expect(data.seatsPurchased).toBe(9);
      // Would be an Invalid Date if read off the subscription instead.
      expect(data.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
    });

    it("clears pendingPlanKey once Stripe applies the scheduled downgrade", async () => {
      const tenantPrisma = fakeTenantPrisma({
        tenant: { id: "t1", stripeCustomerId: "cus_1", seatsPurchased: 5, planId: "plan-professional", pendingPlanKey: "starter" },
        planPrice: { interval: "month", plan: { id: "plan-starter", key: "starter", name: "Starter" } },
      });
      const constructEvent = jest.fn().mockReturnValue({
        id: "evt_3b",
        type: "customer.subscription.updated",
        data: { object: subscription({ priceId: "price_starter_m" }) },
      });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      const data = (tenantPrisma._tenantUpdate as jest.Mock).mock.calls[0][0].data;
      expect(data.planId).toBe("plan-starter");
      expect(data.pendingPlanKey).toBeNull();
      expect(tenantPrisma._subscriptionEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "plan_changed", toPlanKey: "starter" }) }),
      );
    });

    it("records a seats_changed event when only the quantity moved", async () => {
      const tenantPrisma = fakeTenantPrisma({
        tenant: { id: "t1", stripeCustomerId: "cus_1", seatsPurchased: 5, planId: "plan-starter", pendingPlanKey: null },
        planPrice: { interval: "month", plan: { id: "plan-starter", key: "starter", name: "Starter" } },
      });
      const constructEvent = jest.fn().mockReturnValue({
        id: "evt_3c",
        type: "customer.subscription.updated",
        data: { object: subscription({ quantity: 12 }) },
      });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(tenantPrisma._subscriptionEventCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: "seats_changed", fromSeats: 5, toSeats: 12 }) }),
      );
    });
  });

  it("customer.subscription.deleted reverts planId to the Free plan, not null, and clears the subscription id", async () => {
    const tenantPrisma = fakeTenantPrisma({
      tenant: { id: "t1", stripeCustomerId: "cus_1", seatsPurchased: 9, planId: "plan-starter" },
      plan: { id: "plan-free", key: "free", name: "Free" },
    });
    const constructEvent = jest
      .fn()
      .mockReturnValue({ id: "evt_4", type: "customer.subscription.deleted", data: { object: subscription({ status: "canceled" }) } });
    const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

    await controller.handle(fakeReq(Buffer.from("{}")), "sig");

    expect(tenantPrisma._tenantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({
          planId: "plan-free",
          stripeSubscriptionId: null,
          subscriptionStatus: "canceled",
          seatsPurchased: 1,
        }),
      }),
    );
  });

  describe("failed and recovered payments", () => {
    it("invoice.payment_failed marks past_due and notifies, rather than hard-locking the workspace", async () => {
      const tenantPrisma = fakeTenantPrisma({ tenant: { id: "t1", stripeCustomerId: "cus_1", subscriptionStatus: "active" } });
      const constructEvent = jest
        .fn()
        .mockReturnValue({ id: "evt_6", type: "invoice.payment_failed", data: { object: { id: "in_1", customer: "cus_1" } } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(tenantPrisma._tenantUpdate).toHaveBeenCalledWith({ where: { id: "t1" }, data: { subscriptionStatus: "past_due" } });
      expect(tenantPrisma._notificationCreateMany).toHaveBeenCalled();
    });

    it("invoice.paid restores an account that was past_due", async () => {
      const tenantPrisma = fakeTenantPrisma({ tenant: { id: "t1", stripeCustomerId: "cus_1", subscriptionStatus: "past_due" } });
      const constructEvent = jest
        .fn()
        .mockReturnValue({ id: "evt_7", type: "invoice.paid", data: { object: { id: "in_2", customer: "cus_1" } } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(tenantPrisma._tenantUpdate).toHaveBeenCalledWith({ where: { id: "t1" }, data: { subscriptionStatus: "active" } });
    });

    it("invoice.paid on a routine renewal changes nothing — subscription.updated already carries the new period", async () => {
      const tenantPrisma = fakeTenantPrisma({ tenant: { id: "t1", stripeCustomerId: "cus_1", subscriptionStatus: "active" } });
      const constructEvent = jest
        .fn()
        .mockReturnValue({ id: "evt_8", type: "invoice.paid", data: { object: { id: "in_3", customer: "cus_1" } } });
      const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

      await controller.handle(fakeReq(Buffer.from("{}")), "sig");

      expect(tenantPrisma._tenantUpdate).not.toHaveBeenCalled();
    });
  });

  it("customer.subscription.trial_will_end notifies without changing any state", async () => {
    const tenantPrisma = fakeTenantPrisma({ tenant: { id: "t1", stripeCustomerId: "cus_1" } });
    const constructEvent = jest.fn().mockReturnValue({
      id: "evt_9",
      type: "customer.subscription.trial_will_end",
      data: { object: subscription({ trialEnd: 1_700_000_000 }) },
    });
    const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

    await controller.handle(fakeReq(Buffer.from("{}")), "sig");

    expect(tenantPrisma._notificationCreateMany).toHaveBeenCalled();
    expect(tenantPrisma._tenantUpdate).not.toHaveBeenCalled();
  });

  it("ignores an unhandled event type without erroring", async () => {
    const tenantPrisma = fakeTenantPrisma({});
    const constructEvent = jest.fn().mockReturnValue({ id: "evt_5", type: "customer.created", data: { object: {} } });
    const controller = new BillingWebhookController(fakeStripe(constructEvent), tenantPrisma);

    const result = await controller.handle(fakeReq(Buffer.from("{}")), "sig");

    expect(result).toEqual({ received: true });
    expect(tenantPrisma._tenantUpdate).not.toHaveBeenCalled();
  });
});
