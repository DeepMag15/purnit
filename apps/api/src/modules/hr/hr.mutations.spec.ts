import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  describeDeleteBlockers,
  wouldCreateCycle,
  resolveDepartmentTierRole,
  departmentDeleteMutation,
  teamDeleteMutation,
  departmentAssignHeadMutation,
} from "./hr.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

describe("describeDeleteBlockers", () => {
  it("returns null when every count is zero", () => {
    expect(describeDeleteBlockers({ "team(s)": 0, "member(s)": 0 })).toBeNull();
  });

  it("names only the non-zero counts", () => {
    const message = describeDeleteBlockers({ "child department(s)": 0, "team(s)": 2, "member(s)": 5 });
    expect(message).toBe("Cannot delete: still has 2 team(s), 5 member(s). Move or reassign them first.");
  });
});

describe("wouldCreateCycle", () => {
  it("is false when the candidate parent isn't in the department's own subtree", () => {
    expect(wouldCreateCycle("dept-other", ["dept-1", "dept-1-child"])).toBe(false);
  });

  it("is true when the candidate parent is the department itself (subtree always includes its own root)", () => {
    expect(wouldCreateCycle("dept-1", ["dept-1", "dept-1-child"])).toBe(true);
  });

  it("is true when the candidate parent is a descendant", () => {
    expect(wouldCreateCycle("dept-1-child", ["dept-1", "dept-1-child", "dept-1-grandchild"])).toBe(true);
  });
});

describe("resolveDepartmentTierRole", () => {
  const genericRole = { id: "role-generic-manager", label: "Manager", sourceBlueprintRoleId: "role.project-manager" };
  const hrManagerRole = { id: "role-hr-manager", label: "HR Manager", sourceBlueprintRoleId: "role.hr-manager" };

  function fakeTx(overlay: unknown, roles: Record<string, unknown>) {
    return {
      departmentTypeRoleLabel: { findFirst: jest.fn().mockResolvedValue(overlay) },
      role: {
        findFirst: jest.fn(({ where }: { where: { id?: string; sourceBlueprintRoleId?: string } }) => {
          if (where.id) return Promise.resolve(roles[where.id] ?? null);
          return Promise.resolve(roles[where.sourceBlueprintRoleId!] ?? null);
        }),
      },
    } as unknown as PrismaTx;
  }

  it("falls back to the plain tier role when the department has no type", async () => {
    const tx = fakeTx(null, { "role.project-manager": genericRole });
    const role = await resolveDepartmentTierRole(tx, "t1", null, "role.project-manager");
    expect(role).toBe(genericRole);
  });

  it("falls back to the plain tier role when the department type has no overlay row at all", async () => {
    const tx = fakeTx(null, { "role.project-manager": genericRole });
    const role = await resolveDepartmentTierRole(tx, "t1", "engineering", "role.project-manager");
    expect(role).toBe(genericRole);
  });

  it("falls back to the plain tier role when an overlay exists but carries no roleOverride (label-only)", async () => {
    const tx = fakeTx({ label: "Engineering Manager", overrideRoleId: null }, { "role.project-manager": genericRole });
    const role = await resolveDepartmentTierRole(tx, "t1", "engineering", "role.project-manager");
    expect(role).toBe(genericRole);
  });

  // The concrete regression test for the bug caught during planning: an
  // HR-typed team/department's Manager tier must resolve to role.hr-manager,
  // not the generic Manager role, or the real bonus permissions
  // (user:manage:tenant, department:manage:tenant) are silently lost.
  it("resolves the overridden role for a department type that genuinely carries a different role, not just a different label", async () => {
    const tx = fakeTx(
      { label: "HR Manager", overrideRoleId: "role-hr-manager" },
      { "role.project-manager": genericRole, "role-hr-manager": hrManagerRole },
    );
    const role = await resolveDepartmentTierRole(tx, "t1", "hr", "role.project-manager");
    expect(role).toBe(hrManagerRole);
  });

  it("falls back to the plain tier role if the overlay's overrideRoleId doesn't resolve to a real materialized role (defensive)", async () => {
    const tx = fakeTx({ label: "HR Manager", overrideRoleId: "role-does-not-exist" }, { "role.project-manager": genericRole });
    const role = await resolveDepartmentTierRole(tx, "t1", "hr", "role.project-manager");
    expect(role).toBe(genericRole);
  });

  it("throws if no role is materialized for the tier at all", async () => {
    const tx = fakeTx(null, {});
    await expect(resolveDepartmentTierRole(tx, "t1", null, "role.project-manager")).rejects.toThrow(/No role materialized/);
  });
});

function context(grants: string[], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("departmentDeleteMutation", () => {
  function fakeTx(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      department: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", tenantId: "t1", parentId: null, type: null }),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn().mockResolvedValue({ id: "d1" }),
        ...((overrides.department as object) ?? {}),
      },
      team: { count: jest.fn().mockResolvedValue(0), ...((overrides.team as object) ?? {}) },
      user: { count: jest.fn().mockResolvedValue(0), ...((overrides.user as object) ?? {}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;
  }

  it("deletes an empty department", async () => {
    const tx = fakeTx();
    const result = await departmentDeleteMutation.resolve({ id: "d1" }, context(["department:manage:tenant"]), tx);
    expect(result).toEqual({ id: "d1" });
    expect((tx as unknown as { department: { delete: jest.Mock } }).department.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
  });

  it("blocks deletion when the department still has teams", async () => {
    const tx = fakeTx({ team: { count: jest.fn().mockResolvedValue(2) } });
    await expect(departmentDeleteMutation.resolve({ id: "d1" }, context(["department:manage:tenant"]), tx)).rejects.toThrow(/2 team\(s\)/);
  });

  it("blocks deletion when the department still has members", async () => {
    const tx = fakeTx({ user: { count: jest.fn().mockResolvedValue(3) } });
    await expect(departmentDeleteMutation.resolve({ id: "d1" }, context(["department:manage:tenant"]), tx)).rejects.toThrow(/3 member\(s\)/);
  });
});

describe("teamDeleteMutation", () => {
  function fakeTx(userCount: number) {
    return {
      team: {
        findFirst: jest.fn().mockResolvedValue({ id: "team1", tenantId: "t1", departmentId: "d1" }),
        delete: jest.fn().mockResolvedValue({ id: "team1" }),
      },
      user: { count: jest.fn().mockResolvedValue(userCount) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;
  }

  it("deletes an empty team", async () => {
    const tx = fakeTx(0);
    const result = await teamDeleteMutation.resolve({ id: "team1" }, context(["department:manage:tenant"]), tx);
    expect(result).toEqual({ id: "team1" });
  });

  it("blocks deletion when the team still has members", async () => {
    const tx = fakeTx(4);
    await expect(teamDeleteMutation.resolve({ id: "team1" }, context(["department:manage:tenant"]), tx)).rejects.toThrow(/4 member\(s\)/);
  });
});

describe("departmentAssignHeadMutation", () => {
  const adminRole = { id: "role-admin", label: "Company Admin", sourceBlueprintRoleId: "role.admin", extendsRoleId: null };
  const deptHeadRole = { id: "role-dept-head", label: "Department Head", sourceBlueprintRoleId: "role.department-head", extendsRoleId: null };
  const hrDeptHeadOverrideRole = { id: "role-hr-head", label: "HR Head", sourceBlueprintRoleId: "role.department-head-hr", extendsRoleId: null };

  function fakeTx({ departmentType, overlay }: { departmentType: string | null; overlay: unknown }) {
    return {
      department: { findFirst: jest.fn().mockResolvedValue({ id: "d1", tenantId: "t1", type: departmentType }) },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: "u2", tenantId: "t1", deletedAt: null }),
        update: jest.fn().mockResolvedValue({ id: "u2" }),
      },
      departmentTypeRoleLabel: { findFirst: jest.fn().mockResolvedValue(overlay) },
      role: {
        findFirst: jest.fn(({ where }: { where: { id?: string; sourceBlueprintRoleId?: string } }) => {
          const roles: Record<string, unknown> = {
            "role-admin": adminRole,
            "role.department-head": deptHeadRole,
            "role-hr-head": hrDeptHeadOverrideRole,
          };
          return Promise.resolve(roles[where.id ?? where.sourceBlueprintRoleId!] ?? null);
        }),
        // isRoleAssignableBy's own chain-walk query — irrelevant here since
        // the actor is Admin (short-circuits true before ever reading this),
        // but the mock must still exist or the call throws.
        findMany: jest.fn().mockResolvedValue([{ id: "role-admin", extendsRoleId: null }]),
      },
      roleAssignment: {
        // The actor (u1) is Admin — isRoleAssignableBy short-circuits true
        // for Admin without needing the target-role chain-walk exercised.
        findMany: jest.fn().mockResolvedValue([{ roleId: "role-admin", role: adminRole }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaTx;
  }

  it("assigns the plain department-head role when the department has no type override", async () => {
    const tx = fakeTx({ departmentType: null, overlay: null });
    await departmentAssignHeadMutation.resolve({ departmentId: "d1", userId: "u2" }, context(["department:manage:tenant"]), tx);
    const roleAssignmentCreate = (tx as unknown as { roleAssignment: { create: jest.Mock } }).roleAssignment.create;
    expect(roleAssignmentCreate).toHaveBeenCalledWith({ data: { tenantId: "t1", userId: "u2", roleId: "role-dept-head" } });
  });

  it("assigns the department type's overridden head role when one exists", async () => {
    const tx = fakeTx({ departmentType: "hr", overlay: { label: "HR Head", overrideRoleId: "role-hr-head" } });
    await departmentAssignHeadMutation.resolve({ departmentId: "d1", userId: "u2" }, context(["department:manage:tenant"]), tx);
    const roleAssignmentCreate = (tx as unknown as { roleAssignment: { create: jest.Mock } }).roleAssignment.create;
    expect(roleAssignmentCreate).toHaveBeenCalledWith({ data: { tenantId: "t1", userId: "u2", roleId: "role-hr-head" } });
  });

  it("places the target user in the department and clears any prior team, without touching any other user", async () => {
    const tx = fakeTx({ departmentType: null, overlay: null });
    await departmentAssignHeadMutation.resolve({ departmentId: "d1", userId: "u2" }, context(["department:manage:tenant"]), tx);
    const userUpdate = (tx as unknown as { user: { update: jest.Mock } }).user.update;
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u2" }, data: { departmentId: "d1", teamId: null } });
  });
});
