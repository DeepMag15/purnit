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
    const user = await tx.user.findFirst({ where: { authUserId } });
    if (!user) throw new NotFoundException("No user record for this session");
    return {
      id: user.id,
      authUserId: user.authUserId,
      tenantId,
      displayName: user.displayName,
      email: user.email,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async get(): Promise<CurrentUser> {
    const { tenantId, authUserId } = this.tenantContext.getOrThrow();
    return this.tenantPrisma.run(tenantId, (tx) => this.getWithTx(tx, tenantId, authUserId));
  }
}
