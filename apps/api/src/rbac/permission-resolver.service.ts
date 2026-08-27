import { Injectable } from "@nestjs/common";
import { TenantPrismaService, type PrismaTx } from "../tenancy/tenant-prisma.service";
import { collapsePermissions, type EffectivePermissions } from "./permission-collapse";

@Injectable()
export class PermissionResolverService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Same resolution, sharing an already-open transaction instead of opening
   * its own — see the matching comment on `CurrentUserService.getWithTx`
   * (performance-audit consolidation, CONTEXT.md §47).
   */
  async resolveEffectivePermissionsWithTx(tx: PrismaTx, _tenantId: string, userId: string): Promise<EffectivePermissions> {
    const assignments = await tx.roleAssignment.findMany({
      where: { userId },
      include: { role: true },
    });
    const roleGrants = assignments.flatMap((a) => a.role.permissions as string[]);

    // Delegation (per-user override) — active (non-revoked) grants only.
    // Sequential with the query above, not Promise.all: both share this
    // caller's transactional `tx`, and issuing concurrent queries against
    // one interactive transaction is the exact bug class isRoleAssignableBy
    // hit (role-hierarchy.ts).
    const delegations = await tx.permissionDelegation.findMany({
      where: { userId, revokedAt: null },
      select: { permission: true },
    });
    const delegationGrants = delegations.map((d) => d.permission);

    return collapsePermissions([...roleGrants, ...delegationGrants]);
  }

  /**
   * Unions the (already-materialized, flat) permission sets of every role
   * assigned to a user and collapses to the broadest scope per resource:action.
   *
   * Simplification (Phase 1): a RoleAssignment's own departmentId/teamId
   * (i.e. "this grant applies only within X") is not yet factored into the
   * result — every Phase 1 assignment is tenant-wide (see AuthService.signup).
   * Revisit when department/team-scoped assignments are actually created.
   */
  async resolveEffectivePermissions(tenantId: string, userId: string): Promise<EffectivePermissions> {
    return this.tenantPrisma.run(tenantId, (tx) => this.resolveEffectivePermissionsWithTx(tx, tenantId, userId));
  }
}
