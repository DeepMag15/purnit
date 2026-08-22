import { BadRequestException } from "@nestjs/common";
import type { PrismaTx, TenantPrismaService } from "../tenancy/tenant-prisma.service";

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

  let limit: number | null;
  if (tenant.stripeSubscriptionId) {
    limit = tenant.seatsPurchased;
  } else {
    const plan = tenant.planId ? await tenantPrisma.root.plan.findUnique({ where: { id: tenant.planId } }) : null;
    // No plan at all means the Phase-1 "everything entitled" default, which
    // has never implied a seat cap — leave it uncapped rather than inventing
    // one that would suddenly block existing tenants.
    limit = plan?.maxSeats ?? null;
  }
  if (limit === null) return;

  const activeUsers = await tx.user.count({ where: { tenantId, deletedAt: null } });
  if (activeUsers < limit) return;

  // The message names the number and the way out — a bare "limit reached"
  // leaves an admin guessing whether to delete someone or pay.
  throw new BadRequestException(
    tenant.stripeSubscriptionId
      ? `All ${limit} seats are in use. Add seats in Settings → Billing to invite more people.`
      : `Your plan includes ${limit} user${limit === 1 ? "" : "s"}. Upgrade in Settings → Billing to invite more people.`,
  );
}
