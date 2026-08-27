import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { delegationsListDataSource } from "./delegation.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "actor1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("delegations.list", () => {
  it("returns only active delegations with the grantor's display name resolved", async () => {
    const tx = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: "u2" }),
        findMany: jest.fn().mockResolvedValue([{ id: "admin1", displayName: "Ada Admin" }]),
      },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "d1", permission: "user:invite:tenant", grantedById: "admin1", createdAt: new Date("2026-08-04") },
        ]),
      },
    } as unknown as PrismaTx;

    const result = (await delegationsListDataSource.resolve({ userId: "u2" }, context(), tx)) as {
      id: string;
      permission: string;
      grantedByName: string;
    }[];

    expect(result).toEqual([
      { id: "d1", permission: "user:invite:tenant", grantedById: "admin1", grantedByName: "Ada Admin", createdAt: new Date("2026-08-04") },
    ]);

    const findManyCall = (tx as unknown as { permissionDelegation: { findMany: jest.Mock } }).permissionDelegation.findMany.mock.calls[0][0];
    expect(findManyCall.where).toMatchObject({ tenantId: "t1", userId: "u2", revokedAt: null });
  });

  it("falls back to 'Unknown' for a grantor that no longer resolves, without a DB call when there are no delegations", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }), findMany: jest.fn() },
      permissionDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    const result = await delegationsListDataSource.resolve({ userId: "u2" }, context(), tx);

    expect(result).toEqual([]);
    expect((tx as unknown as { user: { findMany: jest.Mock } }).user.findMany).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for a missing, cross-tenant, or deleted user", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(delegationsListDataSource.resolve({ userId: "ghost" }, context(), tx)).rejects.toThrow(NotFoundException);
  });
});
