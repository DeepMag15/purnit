import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { roleCreateCustomMutation, roleUpdateCustomMutation, roleCloneMutation, roleDeleteMutation, roleReorderMutation } from "./roles.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("every roles.* mutation requires role:manage", () => {
  it.each([roleCreateCustomMutation, roleUpdateCustomMutation, roleCloneMutation, roleDeleteMutation, roleReorderMutation])("$name", (mutation) => {
    expect(mutation.requiredPermission).toBe("role:manage");
  });
});

describe("role.createCustom", () => {
  it("succeeds when every requested triple is within the actor's own effective grants", async () => {
    const tx = {
      role: { create: jest.fn().mockResolvedValue({ id: "r1" }), aggregate: jest.fn().mockResolvedValue({ _max: { rank: null } }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await roleCreateCustomMutation.resolve(
      { label: "Custom Reviewer", permissions: ["project:read:department"] },
      context(["project:read:tenant"]),
      tx,
    );

    const call = (tx as unknown as { role: { create: jest.Mock } }).role.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      tenantId: "t1",
      label: "Custom Reviewer",
      sourceBlueprintRoleId: null,
      extendsRoleId: null,
      permissions: ["project:read:department"],
    });
  });

  it("defaults the new role's rank to one past the tenant's current max", async () => {
    const tx = {
      role: { create: jest.fn().mockResolvedValue({ id: "r1" }), aggregate: jest.fn().mockResolvedValue({ _max: { rank: 8 } }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await roleCreateCustomMutation.resolve({ label: "Custom", permissions: [] }, context([]), tx);

    const call = (tx as unknown as { role: { create: jest.Mock } }).role.create.mock.calls[0][0];
    expect(call.data.rank).toBe(9);
  });

  it("defaults rank to 0 for the very first role in a tenant with no existing roles", async () => {
    const tx = {
      role: { create: jest.fn().mockResolvedValue({ id: "r1" }), aggregate: jest.fn().mockResolvedValue({ _max: { rank: null } }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await roleCreateCustomMutation.resolve({ label: "Custom", permissions: [] }, context([]), tx);

    const call = (tx as unknown as { role: { create: jest.Mock } }).role.create.mock.calls[0][0];
    expect(call.data.rank).toBe(0);
  });

  it("throws ForbiddenException when a requested triple exceeds the actor's own grants", async () => {
    const tx = { role: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _max: { rank: null } }) } } as unknown as PrismaTx;
    await expect(
      roleCreateCustomMutation.resolve({ label: "Custom", permissions: ["settings:manage:tenant"] }, context(["project:read:tenant"]), tx),
    ).rejects.toThrow(ForbiddenException);
    expect((tx as unknown as { role: { create: jest.Mock } }).role.create).not.toHaveBeenCalled();
  });

  it("throws BadRequestException for a permission not in the catalog", async () => {
    const tx = { role: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _max: { rank: null } }) } } as unknown as PrismaTx;
    await expect(
      roleCreateCustomMutation.resolve({ label: "Custom", permissions: ["task:delete:tenant"] }, context(["task:delete:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws BadRequestException, not a raw crash, on a malformed permission string", async () => {
    const tx = { role: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _max: { rank: null } }) } } as unknown as PrismaTx;
    await expect(roleCreateCustomMutation.resolve({ label: "Custom", permissions: ["garbage"] }, context([]), tx)).rejects.toThrow(BadRequestException);
  });
});

describe("role.updateCustom", () => {
  it("throws NotFoundException when the role doesn't exist or is cross-tenant", async () => {
    const tx = { role: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(roleUpdateCustomMutation.resolve({ roleId: "ghost" }, context(["project:read:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });

  it("rejects editing a blueprint role even for an actor holding every catalog permission", async () => {
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "r1", sourceBlueprintRoleId: "role.admin", permissions: [] }) },
    } as unknown as PrismaTx;
    await expect(
      roleUpdateCustomMutation.resolve({ roleId: "r1", label: "Renamed" }, context(["project:read:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("updates a genuine custom role's label and permissions", async () => {
    const tx = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: "r1", sourceBlueprintRoleId: null, permissions: ["project:read:own"] }),
        update: jest.fn().mockResolvedValue({ id: "r1" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await roleUpdateCustomMutation.resolve({ roleId: "r1", label: "New label", permissions: ["project:read:department"] }, context(["project:read:tenant"]), tx);

    expect((tx as unknown as { role: { update: jest.Mock } }).role.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { label: "New label", permissions: ["project:read:department"] },
    });
  });

  it("a label-only update (no permissions given) skips the escalation check entirely", async () => {
    const tx = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: "r1", sourceBlueprintRoleId: null, permissions: ["settings:manage:tenant"] }),
        update: jest.fn().mockResolvedValue({ id: "r1" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    // Actor holds nothing — would fail escalation if `permissions` were
    // (re-)checked, but it isn't passed here, so only `label` is touched.
    await roleUpdateCustomMutation.resolve({ roleId: "r1", label: "Renamed only" }, context([]), tx);

    expect((tx as unknown as { role: { update: jest.Mock } }).role.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { label: "Renamed only" },
    });
  });
});

describe("role.clone", () => {
  it("copies the source role's permissions array exactly", async () => {
    const sourcePermissions = ["project:read:tenant", "task:create:department"];
    const tx = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: "src", sourceBlueprintRoleId: "role.executive", permissions: sourcePermissions }),
        create: jest.fn().mockResolvedValue({ id: "new" }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await roleCloneMutation.resolve({ sourceRoleId: "src", label: "Executive copy" }, context(sourcePermissions), tx);

    const call = (tx as unknown as { role: { create: jest.Mock } }).role.create.mock.calls[0][0];
    expect(call.data.permissions).toEqual(sourcePermissions);
    expect(call.data).toMatchObject({ sourceBlueprintRoleId: null, extendsRoleId: null, label: "Executive copy" });
  });

  it("still enforces escalation — cloning a role broader than the actor's own is rejected", async () => {
    const tx = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: "admin-role", sourceBlueprintRoleId: "role.admin", permissions: ["settings:manage:tenant"] }),
        create: jest.fn(),
      },
    } as unknown as PrismaTx;

    await expect(roleCloneMutation.resolve({ sourceRoleId: "admin-role", label: "Admin copy" }, context(["project:read:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
    expect((tx as unknown as { role: { create: jest.Mock } }).role.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the source role doesn't exist", async () => {
    const tx = { role: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(roleCloneMutation.resolve({ sourceRoleId: "ghost", label: "x" }, context([]), tx)).rejects.toThrow(NotFoundException);
  });
});

describe("role.delete", () => {
  it("throws BadRequestException for a blueprint role", async () => {
    const tx = { role: { findFirst: jest.fn().mockResolvedValue({ id: "r1", sourceBlueprintRoleId: "role.member" }) } } as unknown as PrismaTx;
    await expect(roleDeleteMutation.resolve({ roleId: "r1" }, context([]), tx)).rejects.toThrow(BadRequestException);
  });

  it("throws ConflictException while the role has active assignments", async () => {
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "r1", sourceBlueprintRoleId: null }) },
      roleAssignment: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaTx;
    await expect(roleDeleteMutation.resolve({ roleId: "r1" }, context([]), tx)).rejects.toThrow(ConflictException);
  });

  it("succeeds once the role has no active assignments", async () => {
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "r1", sourceBlueprintRoleId: null }), delete: jest.fn().mockResolvedValue({ id: "r1" }) },
      roleAssignment: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await roleDeleteMutation.resolve({ roleId: "r1" }, context([]), tx);

    expect((tx as unknown as { role: { delete: jest.Mock } }).role.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });

  it("throws NotFoundException when the role doesn't exist", async () => {
    const tx = { role: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(roleDeleteMutation.resolve({ roleId: "ghost" }, context([]), tx)).rejects.toThrow(NotFoundException);
  });
});

describe("role.reorder", () => {
  function tenantRoles(ids: string[]) {
    return ids.map((id) => ({ id }));
  }

  it("re-ranks every role 0..N-1 in the given order", async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      role: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(tenantRoles(["a", "b", "c"]))
          .mockResolvedValueOnce([{ id: "c" }, { id: "a" }, { id: "b" }]),
        update,
      },
    } as unknown as PrismaTx;

    await roleReorderMutation.resolve({ roleIds: ["c", "a", "b"] }, context([]), tx);

    expect(update).toHaveBeenNthCalledWith(1, { where: { id: "c" }, data: { rank: 0 } });
    expect(update).toHaveBeenNthCalledWith(2, { where: { id: "a" }, data: { rank: 1 } });
    expect(update).toHaveBeenNthCalledWith(3, { where: { id: "b" }, data: { rank: 2 } });
  });

  it("works for a blueprint-sourced role id, not just custom ones — reordering is deliberately allowed for System roles", async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      role: {
        findMany: jest.fn().mockResolvedValueOnce(tenantRoles(["role.intern-row", "role.admin-row"])).mockResolvedValueOnce([]),
        update,
      },
    } as unknown as PrismaTx;

    await roleReorderMutation.resolve({ roleIds: ["role.intern-row", "role.admin-row"] }, context([]), tx);

    expect(update).toHaveBeenCalledTimes(2);
  });

  it("rejects a partial id set (missing a role the tenant actually has)", async () => {
    const tx = { role: { findMany: jest.fn().mockResolvedValueOnce(tenantRoles(["a", "b", "c"])), update: jest.fn() } } as unknown as PrismaTx;

    await expect(roleReorderMutation.resolve({ roleIds: ["a", "b"] }, context([]), tx)).rejects.toThrow(BadRequestException);
    expect((tx as unknown as { role: { update: jest.Mock } }).role.update).not.toHaveBeenCalled();
  });

  it("rejects an id set with an id from outside the tenant's role set", async () => {
    const tx = { role: { findMany: jest.fn().mockResolvedValueOnce(tenantRoles(["a", "b"])), update: jest.fn() } } as unknown as PrismaTx;

    await expect(roleReorderMutation.resolve({ roleIds: ["a", "ghost"] }, context([]), tx)).rejects.toThrow(BadRequestException);
    expect((tx as unknown as { role: { update: jest.Mock } }).role.update).not.toHaveBeenCalled();
  });

  it("rejects a duplicated id even when the array length matches", async () => {
    const tx = { role: { findMany: jest.fn().mockResolvedValueOnce(tenantRoles(["a", "b"])), update: jest.fn() } } as unknown as PrismaTx;

    await expect(roleReorderMutation.resolve({ roleIds: ["a", "a"] }, context([]), tx)).rejects.toThrow(BadRequestException);
    expect((tx as unknown as { role: { update: jest.Mock } }).role.update).not.toHaveBeenCalled();
  });
});
