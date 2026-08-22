import { BadRequestException } from "@nestjs/common";
import type { PrismaTx, TenantPrismaService } from "../tenancy/tenant-prisma.service";

/** Only the tenant fields the seat ceiling depends on. */
export interface TenantSeatState {
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  seatsPurchased: number;
}

/**
 * The seat ceiling a tenant is actually held to — **the single definition**.
 *
 * This exists as its own function because the rule was briefly implemented
 * twice (here and in `billing.capabilities`) and immediately drifted: live
 * verification found the UI reporting "unlimited" while invites were being
 * blocked at 3. A limit that the product enforces but cannot describe is
 * worse than no limit, so both callers now share this one function.
 *
 * `null` means genuinely uncapped.
 */
export function resolveSeatLimit(tenant: TenantSeatState, planMaxSeats: number | null): number | null {
  // A live subscription is capped at what it bought. So is a tenant that
  // *chose* a paid tier at signup but hasn't paid yet ("pending_payment"),
  // otherwise picking Starter and never paying would grant unlimited seats,
  // since every paid tier has `maxSeats: null`.
  if (tenant.stripeSubscriptionId || tenant.subscriptionStatus === "pending_payment") {
    return tenant.seatsPurchased;
  }
  // No plan at all means the Phase-1 "everything entitled" default, which has
  // never implied a seat cap — leave it uncapped rather than inventing one
  // that would suddenly block existing tenants.
  return planMaxSeats;
}

/**
 * Go-Live — the seat ceiling, enforced in one place.
 *
 * Two different ceilings apply depending on whether a tenant is paying:
 *
 * - **Paid** (`stripeSubscriptionId` set) — capped at `Tenant.seatsPurchased`,
 *   the quantity on their Stripe subscription. Adding a seat is self-serve
 *   (`billing.updateSeats`), so the block is a prompt, not a dead end.
 * - **Unpaid** — capped at their plan's own `maxSeats` (Free's 3). Null means
 *   uncapped, which is why the check short-circuits rather than comparing
 *   against a sentinel.
 *
 * The count deliberately reads OUR database rather than asking Stripe: an
 * external API call inside an authorization check would be slow, and would
 * either fail open or start rejecting legitimate invites during a Stripe
 * outage. `Tenant.seatsPurchased` is kept truthful by the signed webhook.
 *
 * Soft-deleted users don't consume a seat — consistent with every other
 * `deletedAt: null` filter in this codebase, and it means removing someone
 * genuinely frees their seat.
 */
export async function assertSeatAvailable(
  tx: PrismaTx,
  tenantPrisma: TenantPrismaService,
  tenantId: string,
): Promise<void> {
  const tenant = await tenantPrisma.root.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  // Only loaded when it could actually matter — a subscribed or
  // pending-payment tenant is capped by its own seat count, not by the plan.
  const plan =
    tenant.stripeSubscriptionId || tenant.subscriptionStatus === "pending_payment" || !tenant.planId
      ? null
      : await tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } });

  const limit = resolveSeatLimit(tenant, plan?.maxSeats ?? null);
  if (limit === null) return;

  const activeUsers = await tx.user.count({ where: { tenantId, deletedAt: null } });
  if (activeUsers < limit) return;

  // The message names the number and the way out — a bare "limit reached"
  // leaves an admin guessing whether to delete someone or pay.
  throw new BadRequestException(
    tenant.stripeSubscriptionId || tenant.subscriptionStatus === "pending_payment"
      ? `All ${limit} seats are in use. Add seats in Settings → Billing to invite more people.`
      : `Your plan includes ${limit} user${limit === 1 ? "" : "s"}. Upgrade in Settings → Billing to invite more people.`,
  );
}
