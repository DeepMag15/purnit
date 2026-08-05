import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { delegationGrantMutation, delegationRevokeMutation } from "./delegation.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userId = "actor1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("delegation.grant and delegation.revoke both require role:manage", () => {
  it.each([delegationGrantMutation, delegationRevokeMutation])("$name", (mutation) => {
    expect(mutation.requiredPermission).toBe("role:manage");
  });
});

describe("delegation.grant", () => {
  it("succeeds when every requested permission is within the actor's own effective grants", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "d1", permission: "user:invite:tenant" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    const created = await delegationGrantMutation.resolve(
      { userId: "u2", permissions: ["user:invite:tenant"] },
      context(["user:invite:tenant"]),
      tx,
    );

    expect(created).toEqual([{ id: "d1", permission: "user:invite:tenant" }]);
    const call = (tx as unknown as { permissionDelegation: { create: jest.Mock } }).permissionDelegation.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ tenantId: "t1", userId: "u2", permission: "user:invite:tenant", grantedById: "actor1" });
  });

  it("throws ForbiddenException when a requested triple exceeds the actor's own grants", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    } as unknown as PrismaTx;

    await expect(
      delegationGrantMutation.resolve({ userId: "u2", permissions: ["settings:manage:tenant"] }, context(["project:read:tenant"]), tx),
    ).rejects.toThrow(ForbiddenException);
    expect((tx as unknown as { permissionDelegation: { create: jest.Mock } }).permissionDelegation.create).not.toHaveBeenCalled();
  });

  it("throws BadRequestException for a permission not in the catalog", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: { findMany: jest.fn(), create: jest.fn() },
    } as unknown as PrismaTx;

    await expect(
      delegationGrantMutation.resolve({ userId: "u2", permissions: ["task:delete:tenant"] }, context(["task:delete:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws BadRequestException, not a raw crash, on a malformed permission string", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: { findMany: jest.fn(), create: jest.fn() },
    } as unknown as PrismaTx;

    await expect(delegationGrantMutation.resolve({ userId: "u2", permissions: ["garbage"] }, context([]), tx)).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for a missing, cross-tenant, or deleted target user", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(delegationGrantMutation.resolve({ userId: "ghost", permissions: ["project:read:own"] }, context(["project:read:own"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws ConflictException when an identical active delegation already exists", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([{ permission: "user:invite:tenant" }]),
        create: jest.fn(),
      },
    } as unknown as PrismaTx;

    await expect(
      delegationGrantMutation.resolve({ userId: "u2", permissions: ["user:invite:tenant"] }, context(["user:invite:tenant"]), tx),
    ).rejects.toThrow(ConflictException);
    expect((tx as unknown as { permissionDelegation: { create: jest.Mock } }).permissionDelegation.create).not.toHaveBeenCalled();
  });

  it("does not conflict against a revoked delegation of the same triple — the query only checks revokedAt: null", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([]), // revoked rows are excluded by the where clause itself
        create: jest.fn().mockResolvedValue({ id: "d2", permission: "user:invite:tenant" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    await delegationGrantMutation.resolve({ userId: "u2", permissions: ["user:invite:tenant"] }, context(["user:invite:tenant"]), tx);

    const findManyCall = (tx as unknown as { permissionDelegation: { findMany: jest.Mock } }).permissionDelegation.findMany.mock.calls[0][0];
    expect(findManyCall.where).toMatchObject({ revokedAt: null });
  });

  it("creates one row per requested permission", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValueOnce({ id: "d1" }).mockResolvedValueOnce({ id: "d2" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    const created = await delegationGrantMutation.resolve(
      { userId: "u2", permissions: ["project:read:tenant", "task:create:tenant"] },
      context(["project:read:tenant", "task:create:tenant"]),
      tx,
    );

    expect((tx as unknown as { permissionDelegation: { create: jest.Mock } }).permissionDelegation.create).toHaveBeenCalledTimes(2);
    expect(created).toEqual([{ id: "d1" }, { id: "d2" }]);
  });

  it("fires a delegation.granted notification to the target, skipped on self-delegation", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "actor1" }) },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "d1" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    // Self-delegation: userId === ctx.userId
    await delegationGrantMutation.resolve({ userId: "actor1", permissions: ["project:read:own"] }, context(["project:read:own"], "actor1"), tx);
    expect((tx as unknown as { notification: { create: jest.Mock } }).notification.create).not.toHaveBeenCalled();

    const tx2 = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      permissionDelegation: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "d1" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    await delegationGrantMutation.resolve({ userId: "u2", permissions: ["project:read:own"] }, context(["project:read:own"], "actor1"), tx2);
    const notifyCall = (tx2 as unknown as { notification: { create: jest.Mock } }).notification.create.mock.calls[0][0];
    expect(notifyCall.data).toMatchObject({ tenantId: "t1", userId: "u2", type: "delegation.granted" });
  });
});

describe("delegation.revoke", () => {
  it("throws NotFoundException for a missing, cross-tenant, or already-revoked delegation", async () => {
    const tx = { permissionDelegation: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(delegationRevokeMutation.resolve({ delegationId: "ghost" }, context([]), tx)).rejects.toThrow(NotFoundException);
  });

  it("sets revokedAt/revokedById on success", async () => {
    const tx = {
      permissionDelegation: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", userId: "u2", permission: "project:read:own", revokedAt: null }),
        update: jest.fn().mockResolvedValue({ id: "d1", revokedAt: new Date() }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    await delegationRevokeMutation.resolve({ delegationId: "d1" }, context([], "actor1"), tx);

    const call = (tx as unknown as { permissionDelegation: { update: jest.Mock } }).permissionDelegation.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "d1" });
    expect(call.data).toMatchObject({ revokedById: "actor1" });
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });

  it("succeeds revoking a delegation the actor did NOT originally grant — decision #3: no escalation guard on this path", async () => {
    const tx = {
      permissionDelegation: {
        // grantedById is a different user than the revoking actor — no
        // assertPermissionsGrantableByActor-style check exists on this path.
        findFirst: jest.fn().mockResolvedValue({ id: "d1", userId: "u2", permission: "settings:manage:tenant", grantedById: "some-admin", revokedAt: null }),
        update: jest.fn().mockResolvedValue({ id: "d1" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;

    // Actor holds nothing at all — would fail if any escalation check ran.
    await expect(delegationRevokeMutation.resolve({ delegationId: "d1" }, context([], "actor1"), tx)).resolves.toBeDefined();
  });

  it("fires a delegation.revoked notification to the delegation's user, skipped on self-revoke", async () => {
    const txSelf = {
      permissionDelegation: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", userId: "actor1", permission: "project:read:own", revokedAt: null }),
        update: jest.fn().mockResolvedValue({ id: "d1" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;
    await delegationRevokeMutation.resolve({ delegationId: "d1" }, context([], "actor1"), txSelf);
    expect((txSelf as unknown as { notification: { create: jest.Mock } }).notification.create).not.toHaveBeenCalled();

    const txOther = {
      permissionDelegation: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", userId: "u2", permission: "project:read:own", revokedAt: null }),
        update: jest.fn().mockResolvedValue({ id: "d1" }),
      },
      notification: { create: jest.fn() },
    } as unknown as PrismaTx;
    await delegationRevokeMutation.resolve({ delegationId: "d1" }, context([], "actor1"), txOther);
    const notifyCall = (txOther as unknown as { notification: { create: jest.Mock } }).notification.create.mock.calls[0][0];
    expect(notifyCall.data).toMatchObject({ tenantId: "t1", userId: "u2", type: "delegation.revoked" });
  });
});
