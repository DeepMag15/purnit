import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { dashboardLayoutSaveMutation, dashboardLayoutResetMutation, dashboardLayoutSaveAsTemplateMutation } from "./dashboard-layout.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []): MutationContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

const SAMPLE_WIDGETS = [{ key: "tasks.openCount", visible: true, x: 0, y: 0, w: 6, h: 4 }];

describe("dashboardLayout.save", () => {
  it("has no requiredPermission — every tenant member may save their own personal layout", () => {
    expect(dashboardLayoutSaveMutation.requiredPermission).toBeUndefined();
  });

  it("creates version 1 with no prior active row", async () => {
    const create = jest.fn().mockResolvedValue({ id: "row1", version: 1 });
    const tx = { dashboardLayout: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), create } } as unknown as PrismaTx;

    await dashboardLayoutSaveMutation.resolve({ widgets: SAMPLE_WIDGETS, dashboardKey: "analytics" }, context(), tx);
    expect((tx as unknown as { dashboardLayout: { update: jest.Mock } }).dashboardLayout.update).not.toHaveBeenCalled();
    expect(create.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", userId: "u1", dashboardKey: "analytics", widgets: SAMPLE_WIDGETS, version: 1, isActive: true });
  });

  it("deactivates the prior active personal row and creates version 2 — never UPDATEs widgets in place", async () => {
    const current = { id: "row1", version: 1 };
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({ id: "row2", version: 2 });
    const tx = { dashboardLayout: { findFirst: jest.fn().mockResolvedValue(current), update, create } } as unknown as PrismaTx;

    await dashboardLayoutSaveMutation.resolve({ widgets: SAMPLE_WIDGETS, dashboardKey: "analytics" }, context(), tx);
    expect(update.mock.calls[0]![0]).toEqual({ where: { id: "row1" }, data: { isActive: false } });
    expect(create.mock.calls[0]![0].data).toMatchObject({ userId: "u1", version: 2, isActive: true });
  });

  it("scopes the active-row lookup to the caller's own userId, not any other user's layout", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const tx = { dashboardLayout: { findFirst, update: jest.fn(), create: jest.fn().mockResolvedValue({}) } } as unknown as PrismaTx;

    await dashboardLayoutSaveMutation.resolve({ widgets: SAMPLE_WIDGETS, dashboardKey: "analytics" }, context(), tx);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: "t1", userId: "u1", dashboardKey: "analytics", isActive: true });
  });

  // Platform UI/UX Redesign, Phase F — dashboardKey generalization. The
  // MutationsController always runs `inputSchema.parse(raw)` before
  // resolve() is ever called, so `resolve()` itself correctly requires
  // `dashboardKey` (Zod's `.default()` already filled it in by then) — the
  // defaulting behavior itself is a schema-level guarantee, tested directly
  // against the exported `inputSchema` rather than by omitting the field
  // from a direct resolve() call (which the type system now rightly rejects).
  it("inputSchema defaults dashboardKey to \"analytics\" when the caller omits it, matching every pre-Phase-F call site", () => {
    const parsed = dashboardLayoutSaveMutation.inputSchema.parse({ widgets: SAMPLE_WIDGETS });
    expect(parsed.dashboardKey).toBe("analytics");
  });

  it("scopes the active-row lookup and the created row by a caller-supplied dashboardKey, independent of any existing \"analytics\" row", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({});
    const tx = { dashboardLayout: { findFirst, update: jest.fn(), create } } as unknown as PrismaTx;

    await dashboardLayoutSaveMutation.resolve({ widgets: SAMPLE_WIDGETS, dashboardKey: "dashboard" }, context(), tx);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: "t1", userId: "u1", dashboardKey: "dashboard", isActive: true });
    expect(create.mock.calls[0]![0].data.dashboardKey).toBe("dashboard");
  });
});

describe("dashboardLayout.reset", () => {
  it("has no requiredPermission", () => {
    expect(dashboardLayoutResetMutation.requiredPermission).toBeUndefined();
  });

  it("deactivates the caller's active personal row, inserts no new row", async () => {
    const current = { id: "row1", version: 1 };
    const update = jest.fn().mockResolvedValue({});
    const tx = { dashboardLayout: { findFirst: jest.fn().mockResolvedValue(current), update } } as unknown as PrismaTx;

    const result = await dashboardLayoutResetMutation.resolve({ dashboardKey: "analytics" }, context(), tx);
    expect(update.mock.calls[0]![0]).toEqual({ where: { id: "row1" }, data: { isActive: false } });
    expect(result).toEqual({ success: true });
  });

  it("is a no-op, not an error, when the caller has no personal layout to begin with", async () => {
    const update = jest.fn();
    const tx = { dashboardLayout: { findFirst: jest.fn().mockResolvedValue(null), update } } as unknown as PrismaTx;

    const result = await dashboardLayoutResetMutation.resolve({ dashboardKey: "analytics" }, context(), tx);
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("scopes the reset lookup by a caller-supplied dashboardKey", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const tx = { dashboardLayout: { findFirst, update: jest.fn() } } as unknown as PrismaTx;

    await dashboardLayoutResetMutation.resolve({ dashboardKey: "dashboard" }, context(), tx);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: "t1", userId: "u1", dashboardKey: "dashboard", isActive: true });
  });

  it("inputSchema defaults dashboardKey to \"analytics\" when the caller omits it", () => {
    const parsed = dashboardLayoutResetMutation.inputSchema.parse({});
    expect(parsed.dashboardKey).toBe("analytics");
  });
});

describe("dashboardLayout.saveAsTemplate", () => {
  it("requires role:manage", () => {
    expect(dashboardLayoutSaveAsTemplateMutation.requiredPermission).toBe("role:manage");
  });

  it("throws NotFoundException for a roleId that doesn't exist in this tenant", async () => {
    const tx = { role: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      dashboardLayoutSaveAsTemplateMutation.resolve({ roleId: "ghost-role", widgets: SAMPLE_WIDGETS, dashboardKey: "analytics" }, context(["role:manage:tenant"]), tx),
    ).rejects.toThrow(NotFoundException);
  });

  it("deactivates the target role's prior active row and creates a new version, keyed by roleId not userId", async () => {
    const current = { id: "row1", version: 1 };
    const update = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({ id: "row2", version: 2 });
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "role-1", tenantId: "t1" }) },
      dashboardLayout: { findFirst: jest.fn().mockResolvedValue(current), update, create },
    } as unknown as PrismaTx;

    await dashboardLayoutSaveAsTemplateMutation.resolve({ roleId: "role-1", widgets: SAMPLE_WIDGETS, dashboardKey: "analytics" }, context(["role:manage:tenant"]), tx);
    expect(update.mock.calls[0]![0]).toEqual({ where: { id: "row1" }, data: { isActive: false } });
    expect(create.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", roleId: "role-1", version: 2, isActive: true });
    expect(create.mock.calls[0]![0].data.userId).toBeUndefined();
  });

  it("inputSchema defaults dashboardKey to \"analytics\" when the caller omits it", () => {
    const parsed = dashboardLayoutSaveAsTemplateMutation.inputSchema.parse({ roleId: "role-1", widgets: SAMPLE_WIDGETS });
    expect(parsed.dashboardKey).toBe("analytics");
  });

  it("scopes the role-template lookup and created row by a caller-supplied dashboardKey", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({});
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "role-1", tenantId: "t1" }) },
      dashboardLayout: { findFirst, update: jest.fn(), create },
    } as unknown as PrismaTx;

    await dashboardLayoutSaveAsTemplateMutation.resolve({ roleId: "role-1", widgets: SAMPLE_WIDGETS, dashboardKey: "dashboard" }, context(["role:manage:tenant"]), tx);
    expect(findFirst.mock.calls[0]![0].where).toEqual({ tenantId: "t1", roleId: "role-1", dashboardKey: "dashboard", isActive: true });
    expect(create.mock.calls[0]![0].data.dashboardKey).toBe("dashboard");
  });
});
