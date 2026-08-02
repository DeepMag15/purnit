import type { PrismaTx } from "../tenancy/tenant-prisma.service";

/**
 * Pure core: can a role whose own `extends` ancestry is described by
 * `actorRoleIds`/`parentById` assign `targetRoleId`? "At or below my own
 * tier" is relative to *my* chain, not the target's — walks up from each of
 * the actor's own roles and allows it only if `targetRoleId` is that role
 * itself or one of its ancestors. This is why HR Manager (chain
 * `hr-manager -> employee -> intern`) can assign Employee/Intern but not
 * Senior Employee/Team Lead/etc. even though those sound "lower": they're a
 * different branch, not an ancestor of HR Manager's own role.
 *
 * `parentById` maps a role's id to its `extendsRoleId` (or `null`/`undefined`
 * for a root role) — the tenant's materialized role graph.
 */
export function isRoleAssignable(actorIsAdmin: boolean, actorRoleIds: readonly string[], targetRoleId: string, parentById: ReadonlyMap<string, string | null>): boolean {
  if (actorIsAdmin) return true;

  for (const roleId of actorRoleIds) {
    let current: string | null | undefined = roleId;
    while (current != null) {
      if (current === targetRoleId) return true;
      current = parentById.get(current);
    }
  }
  return false;
}

/**
 * DB-touching wrapper: fetches the actor's currently-assigned roles and the
 * tenant's full role graph, then delegates to `isRoleAssignable`. Used by
 * `user.invite` (before assigning a role to a brand-new user) and
 * `user.changeRole` (before reassigning an existing user's role).
 */
export async function isRoleAssignableBy(tx: PrismaTx, tenantId: string, actorUserId: string, targetRoleId: string): Promise<boolean> {
  // Sequential, not `Promise.all` — an interactive transaction is bound to
  // one reserved connection, and Prisma explicitly documents that issuing
  // concurrent queries against the same `tx` is unsafe (it can corrupt the
  // transaction's connection state). This was a real, live bug: it caused
  // intermittent `ERR_HTTP_HEADERS_SENT` 500s on `user.invite`, the one
  // caller of this function, discovered via user report and API log
  // inspection. Every `tx`-sharing query in a resolver must be sequential.
  const actorAssignments = await tx.roleAssignment.findMany({ where: { tenantId, userId: actorUserId }, include: { role: true } });
  const allRoles = await tx.role.findMany({ where: { tenantId }, select: { id: true, extendsRoleId: true } });

  const actorIsAdmin = actorAssignments.some((a) => a.role.sourceBlueprintRoleId === "role.admin");
  const actorRoleIds = actorAssignments.map((a) => a.roleId);
  const parentById = new Map(allRoles.map((r) => [r.id, r.extendsRoleId]));

  return isRoleAssignable(actorIsAdmin, actorRoleIds, targetRoleId, parentById);
}
