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
 *
 * **Students don't consume a seat either** (Student Role, 2026-08-25). Purnit
 * sells staff seats; a 2,000-student college is not a 2,000-seat customer, and
 * counting learners here would have made the Student role commercially
 * unusable the moment it shipped. Identified by the blueprint role behind the
 * assignment (`role.student`), not by a flag on User — the blueprint is
 * already the single source of what a role *is*, and a per-user flag would be
 * a second one to keep in sync.
 */
export const NON_BILLABLE_BLUEPRINT_ROLES = ["role.student"];
/**
 * Active users who consume a paid seat.
 *
 * Written as an explicit exclusion set rather than a nested relation filter
 * because `RoleAssignment` has no back-relation on `User` — and the two edge
 * cases both matter and both go the same way (counted):
 *
 * - someone holding a student role **and** a staff role is staff, and pays;
 * - someone holding **no** role at all still pays. A `NOT (every …)` filter
 *   would have silently excluded them, since `every` is vacuously true over an
 *   empty relation — a free seat for anyone whose role assignment failed.
 *
 * Sequential queries, not `Promise.all` — same shared-`tx` rule as every other
 * multi-query path in this codebase (CONTEXT.md §9).
 */
export async function countBillableUsers(tx: PrismaTx, tenantId: string): Promise<number> {
  const nonBillable = await tx.roleAssignment.findMany({
    where: { tenantId, role: { sourceBlueprintRoleId: { in: NON_BILLABLE_BLUEPRINT_ROLES } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (nonBillable.length === 0) {
    return tx.user.count({ where: { tenantId, deletedAt: null } });
  }

  const alsoStaff = await tx.roleAssignment.findMany({
    where: {
      tenantId,
      userId: { in: nonBillable.map((a) => a.userId) },
      NOT: { role: { sourceBlueprintRoleId: { in: NON_BILLABLE_BLUEPRINT_ROLES } } },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  const staffIds = new Set(alsoStaff.map((a) => a.userId));
  const exempt = nonBillable.map((a) => a.userId).filter((id) => !staffIds.has(id));
  if (exempt.length === 0) {
    return tx.user.count({ where: { tenantId, deletedAt: null } });
  }

  return tx.user.count({ where: { tenantId, deletedAt: null, id: { notIn: exempt } } });
}

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

  const activeUsers = await countBillableUsers(tx, tenantId);
  if (activeUsers < limit) return;

  // The message names the number and the way out — a bare "limit reached"
  // leaves an admin guessing whether to delete someone or pay.
  throw new BadRequestException(
    tenant.stripeSubscriptionId || tenant.subscriptionStatus === "pending_payment"
      ? `All ${limit} seats are in use. Add seats in Settings → Billing to invite more people.`
      : `Your plan includes ${limit} user${limit === 1 ? "" : "s"}. Upgrade in Settings → Billing to invite more people.`,
  );
}
