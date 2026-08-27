import { Injectable, NotFoundException } from "@nestjs/common";
import { TenantContextService } from "./tenant-context.service";
import { TenantPrismaService, type PrismaTx } from "./tenant-prisma.service";

export interface CurrentUser {
  id: string;
  authUserId: string;
  tenantId: string;
  displayName: string;
  email: string;
  departmentId: string | null;
  mustChangePassword: boolean;
  digestOptOut: boolean;
}

/** Resolves the internal User row for the current request's auth context.
 * Extracted here once it was needed in a third controller — was duplicated
 * inline in MeController and would have been a third time in
 * WorkspaceController. */
@Injectable()
export class CurrentUserService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /**
   * Shares an already-open transaction instead of opening its own — the
   * performance-audit consolidation (CONTEXT.md §47): every data-source and
   * mutation call used to pay for this as its own separate `.run()`
   * transaction (~600ms of pure BEGIN/set_config/COMMIT overhead against the
   * real remote DB) on top of the permission-resolution and actual-work
   * transactions right next to it. Same query, same shape — just issued as
   * one more sequential await inside the caller's own transaction.
   */
  async getWithTx(tx: PrismaTx, tenantId: string, authUserId: string): Promise<CurrentUser> {
    // ⚠️ `deletedAt: null` is load-bearing as of Go-Live Phase 05, not a
    // defensive filter. This lookup is the chokepoint every authenticated
    // request passes through (workspace bootstrap, every data source, every
    // mutation), and it previously matched deleted users too — which was
    // harmless only because nothing had ever soft-deleted a User row. The
    // moment account deletion and workspace closure exist, omitting it would
    // make both features cosmetic: the account would look deleted while
    // retaining full access to every record in the tenant.
    const user = await tx.user.findFirst({ where: { authUserId, deletedAt: null } });
    if (!user) throw new NotFoundException("No user record for this session");
    return {
      id: user.id,
      authUserId: user.authUserId,
      tenantId,
      displayName: user.displayName,
      email: user.email,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
      digestOptOut: user.digestOptOut,
    };
  }

  async get(): Promise<CurrentUser> {
    const { tenantId, authUserId } = this.tenantContext.getOrThrow();
    return this.tenantPrisma.run(tenantId, (tx) => this.getWithTx(tx, tenantId, authUserId));
  }
}
