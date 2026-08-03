import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { PERMISSION_CATALOG } from "../../rbac/permission-catalog";
import { rolesListDetailedDataSource, permissionsCatalogDataSource, createUsersEffectivePermissionsDataSource } from "./roles.data-sources";
import type { PermissionResolverService } from "../../rbac/permission-resolver.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("roles.listDetailed", () => {
  it("returns each role with its assignment count, defaulting to 0 for roles with none", async () => {
    const tx = {
      role: {
        findMany: jest.fn().mockResolvedValue([
          { id: "r1", label: "Admin", sourceBlueprintRoleId: "role.admin", extendsRoleId: null, permissions: ["settings:manage:tenant"] },
          { id: "r2", label: "Custom", sourceBlueprintRoleId: null, extendsRoleId: null, permissions: [] },
        ]),
      },
      roleAssignment: { groupBy: jest.fn().mockResolvedValue([{ roleId: "r1", _count: { roleId: 3 } }]) },
    } as unknown as PrismaTx;

    const result = (await rolesListDetailedDataSource.resolve({}, context(), tx)) as { id: string; assignmentCount: number }[];

    expect(result.find((r) => r.id === "r1")?.assignmentCount).toBe(3);
    expect(result.find((r) => r.id === "r2")?.assignmentCount).toBe(0);
  });
});

describe("permissions.catalog", () => {
  it("returns the catalog verbatim, no DB query", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await permissionsCatalogDataSource.resolve({}, context(), tx);
    expect(result).toBe(PERMISSION_CATALOG);
  });
});

describe("users.effectivePermissions", () => {
  it("returns the target user's flat permissions and contributing roles", async () => {
    const resolver = {
      resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions(["project:read:tenant", "task:create:own"])),
    } as unknown as PermissionResolverService;
    const dataSource = createUsersEffectivePermissionsDataSource(resolver);

    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      roleAssignment: {
        findMany: jest.fn().mockResolvedValue([{ role: { id: "r1", label: "Manager", sourceBlueprintRoleId: "role.project-manager" } }]),
      },
    } as unknown as PrismaTx;

    const result = (await dataSource.resolve({ userId: "u2" }, context(), tx)) as { userId: string; permissions: string[]; roles: unknown[] };

    expect(result.userId).toBe("u2");
    expect(result.permissions).toEqual(expect.arrayContaining(["project:read:tenant", "task:create:own"]));
    expect(result.roles).toEqual([{ id: "r1", label: "Manager", sourceBlueprintRoleId: "role.project-manager" }]);
  });

  it("throws NotFoundException for a missing or cross-tenant/deleted user", async () => {
    const resolver = { resolveEffectivePermissionsWithTx: jest.fn() } as unknown as PermissionResolverService;
    const dataSource = createUsersEffectivePermissionsDataSource(resolver);
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;

    await expect(dataSource.resolve({ userId: "ghost" }, context(), tx)).rejects.toThrow(NotFoundException);
  });
});
