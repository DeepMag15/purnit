import { collapsePermissions } from "../../rbac/permission-collapse";
import { dashboardLayoutGetDataSource } from "./dashboard-layout.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions([]) };
}

const SAMPLE_WIDGETS = [{ key: "tasks.openCount", visible: true, x: 0, y: 0, w: 6, h: 4 }];

describe("dashboardLayout.get", () => {
  it("returns the caller's personal layout when one exists, without checking role assignment at all", async () => {
    const roleAssignmentFindFirst = jest.fn();
    const tx = {
      dashboardLayout: { findFirst: jest.fn().mockResolvedValue({ widgets: SAMPLE_WIDGETS }) },
      roleAssignment: { findFirst: roleAssignmentFindFirst },
    } as unknown as PrismaTx;

    const result = await dashboardLayoutGetDataSource.resolve({ dashboardKey: "dashboard" }, context(), tx);
    expect(result).toEqual({ layout: SAMPLE_WIDGETS });
    expect(roleAssignmentFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to the caller's role-level template when no personal layout exists", async () => {
    const findFirst = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ widgets: SAMPLE_WIDGETS });
    const tx = {
      dashboardLayout: { findFirst },
      roleAssignment: { findFirst: jest.fn().mockResolvedValue({ roleId: "role-1" }) },
    } as unknown as PrismaTx;

    const result = await dashboardLayoutGetDataSource.resolve({ dashboardKey: "dashboard" }, context(), tx);
    expect(result).toEqual({ layout: SAMPLE_WIDGETS });
    expect(findFirst.mock.calls[1]![0].where).toEqual({ tenantId: "t1", roleId: "role-1", userId: null, dashboardKey: "dashboard", isActive: true });
  });

  it("returns undefined when neither a personal nor a role-level layout exists", async () => {
    const tx = {
      dashboardLayout: { findFirst: jest.fn().mockResolvedValue(null) },
      roleAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;

    const result = await dashboardLayoutGetDataSource.resolve({ dashboardKey: "dashboard" }, context(), tx);
    expect(result).toEqual({ layout: undefined });
  });

  it("scopes the personal-layout lookup by the given dashboardKey, distinct from any \"analytics\" row", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const tx = {
      dashboardLayout: { findFirst },
      roleAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;

    await dashboardLayoutGetDataSource.resolve({ dashboardKey: "dashboard" }, context(), tx);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: "t1", userId: "u1", dashboardKey: "dashboard", isActive: true });
  });

  it("has no requiredPermission — a layout only repositions widgets each already independently permission-checks", () => {
    expect(dashboardLayoutGetDataSource.requiredPermission).toBeUndefined();
  });
});
