import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/**
 * ORG_HIERARCHY.md §9-10's first real consumer of `User.managerId` — the
 * default approver for a leave request is simply the requester's own direct
 * manager, resolved once at submission time and stored on the row
 * (`LeaveRequest.approverId`), not re-derived on every read.
 *
 * Deliberately one hop, not a multi-level chain-walk: §10's "escalation
 * walks the manager chain" describes what happens when the assigned
 * approver can't act, not a routing algorithm to run up front. Building
 * automatic multi-hop escalation-on-timeout would need a real SLA/scheduled-
 * job concept nobody asked for. Instead, Department Head (own department)/
 * Executive (subtree)/Company Admin (tenant) retain override visibility on
 * every pending request in their scope regardless of who `approverId`
 * is — that IS the escalation path, via the same dual-path authorization
 * `attendance.correct` already established (leave.mutations.ts).
 *
 * `null` is a valid, expected return (no manager set) — the request still
 * exists and is still actionable, just only by the override-visibility
 * tiers, never by a direct-manager fast path that doesn't exist.
 */
export async function resolveApprover(tx: PrismaTx, tenantId: string, userId: string): Promise<string | null> {
  const requester = await tx.user.findFirst({ where: { id: userId, tenantId }, select: { managerId: true } });
  return requester?.managerId ?? null;
}
