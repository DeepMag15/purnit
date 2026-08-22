import type { MutationContext } from "../mutations/mutation-registry.service";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";

export interface AuditEntryParams {
  action: string;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Audit Logs (module 6 of 6, the last of the approved 6-module backlog) —
 * a shared helper called from a bounded ~15-20 high-value security/
 * compliance mutations (role/permission changes, user lifecycle, delegation,
 * a handful of significant deletes, settings/branding), not all ~150+
 * mutations in this codebase — see each call site's own comment for why it
 * was included.
 *
 * `ip`/`userAgent` are always left null in v1 — `MutationContext` carries no
 * HTTP request context (see mutation-registry.service.ts), and threading one
 * through every mutation resolver just for this would be real, disclosed
 * scope creep beyond what this module asked for. A real gap, not a silent
 * omission — the columns exist on `AuditLog` for exactly this, unpopulated
 * until a future phase actually needs it.
 *
 * Runs inside the caller's own already-open `tx` (MutationsController wraps
 * every resolve() in one transaction) — an audit write is part of the same
 * atomic unit as the mutation itself, never a best-effort side call that
 * could silently fail to record a real change.
 */
export async function logAudit(tx: PrismaTx, ctx: MutationContext, params: AuditEntryParams): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      before: params.before === undefined ? undefined : (params.before as object),
      after: params.after === undefined ? undefined : (params.after as object),
    },
  });
}
