import { PermissionResolverService } from "./permission-resolver.service";
import type { TenantPrismaService, PrismaTx } from "../tenancy/tenant-prisma.service";

// resolveEffectivePermissionsWithTx never touches this.tenantPrisma —
// resolveEffectivePermissions (the non-tx wrapper) is the only method that
// does, and it's untouched by this change — so a dummy is fine here.
function service() {
  return new PermissionResolverService({} as unknown as TenantPrismaService);
}

describe("PermissionResolverService.resolveEffectivePermissionsWithTx", () => {
  it("unions role grants and active delegation grants, collapsing to broadest scope per resource:action", async () => {
    const tx = {
      roleAssignment: {
        findMany: jest.fn().mockResolvedValue([{ role: { permissions: ["project:read:own"] } }]),
      },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([{ permission: "project:read:tenant" }, { permission: "user:invite:tenant" }]),
      },
    } as unknown as PrismaTx;

    const result = await service().resolveEffectivePermissionsWithTx(tx, "t1", "u1");

    // Delegation grants "project:read:tenant", broader than the role's
    // "project:read:own" — collapsePermissions must keep the broader one.
    expect(result.has("project", "read")).toBe("tenant");
    expect(result.toArray()).toEqual(["project:read:tenant", "user:invite:tenant"]);
  });

  it("excludes revoked delegations — the query only ever asks for revokedAt: null", async () => {
    const tx = {
      roleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      permissionDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await service().resolveEffectivePermissionsWithTx(tx, "t1", "u1");

    const delegationCall = (tx as unknown as { permissionDelegation: { findMany: jest.Mock } }).permissionDelegation.findMany.mock.calls[0][0];
    expect(delegationCall.where).toMatchObject({ userId: "u1", revokedAt: null });
  });

  it("behaves identically to pre-Delegation output when the delegations table is empty — a regression guard", async () => {
    const tx = {
      roleAssignment: {
        findMany: jest.fn().mockResolvedValue([{ role: { permissions: ["task:create:department"] } }]),
      },
      permissionDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    const result = await service().resolveEffectivePermissionsWithTx(tx, "t1", "u1");

    expect(result.toArray()).toEqual(["task:create:department"]);
  });
});
