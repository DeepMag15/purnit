import { ForbiddenException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { MetricRegistry, type ScalarMetricDefinition, type BreakdownMetricDefinition, type CompositeMetricDefinition } from "../../metrics/metric-registry.service";
import { createAnalyticsDashboardDataSource, createAnalyticsTrendDataSource, analyticsCapabilitiesDataSource } from "./analytics.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userDepartmentId: string | null = null): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

function gatedScalar(key: string, requiredPermission: string | undefined, value: number, withSnapshot = false): ScalarMetricDefinition {
  return {
    kind: "scalar",
    key,
    module: "Test",
    label: key,
    requiredPermission,
    format: "count",
    computeLive: async () => value,
    ...(withSnapshot ? { snapshot: { computeDaily: async () => [{ departmentId: null, value }] } } : {}),
  };
}

function breakdown(key: string, requiredPermission: string): BreakdownMetricDefinition {
  return { kind: "breakdown", key, module: "Test", label: key, requiredPermission, nameKey: "name", valueKey: "value", computeLive: async () => [{ name: "a", value: 1 }] };
}

// analytics.dashboard's resolver always looks up the caller's role-level
// DashboardLayout (Phase D) after building widgets — every tx mock in this
// describe block needs these two stubs, same as `{}` used to be enough
// before this phase. Defaults to "no template found" (the pre-Phase-D
// tenant fallback); tests that care about sectionOrder override explicitly.
function withRoleLookup(extra: Record<string, unknown> = {}): PrismaTx {
  return {
    roleAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    dashboardLayout: { findFirst: jest.fn() },
    ...extra,
  } as unknown as PrismaTx;
}

describe("analytics.dashboard", () => {
  it("omits a widget the actor lacks permission for — absent, not present-with-error", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("gated.metric", "settings:manage", 5));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup();

    const result = (await dataSource.resolve({}, context([]), tx)) as { widgets: unknown[] };
    expect(result.widgets).toEqual([]);
  });

  it("a zero-grant actor still receives an ungated metric", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("open.metric", undefined, 7));
    registry.register(gatedScalar("gated.metric", "settings:manage", 5));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup({ analyticsSnapshot: { findMany: jest.fn() } });

    const result = (await dataSource.resolve({}, context([]), tx)) as { widgets: { key: string }[] };
    expect(result.widgets.map((w) => w.key)).toEqual(["open.metric"]);
  });

  it("populates trend at tenant scope and at department scope (with a real department) — absent (value still present) at own/team/department-subtree, or department scope with no department set", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("trendy.metric", "task:read", 42, true));
    const dataSource = createAnalyticsDashboardDataSource(registry);

    const txTenant = withRoleLookup({ analyticsSnapshot: { findMany: jest.fn().mockResolvedValue([{ value: 1 }, { value: 2 }]) } });
    const tenantResult = (await dataSource.resolve({}, context(["task:read:tenant"]), txTenant)) as { widgets: { trend?: number[]; value: number }[] };
    expect(tenantResult.widgets[0]!.trend).toEqual([1, 2]);
    expect(tenantResult.widgets[0]!.value).toBe(42);
    expect((txTenant as unknown as { analyticsSnapshot: { findMany: jest.Mock } }).analyticsSnapshot.findMany.mock.calls[0][0].where).toMatchObject({
      departmentId: null,
    });

    // Phase B: a department-scope viewer with a real department now gets a
    // real trend, scoped to exactly their own department's snapshot rows —
    // the core unlock of this phase.
    const txDept = withRoleLookup({ analyticsSnapshot: { findMany: jest.fn().mockResolvedValue([{ value: 5 }]) } });
    const deptResult = (await dataSource.resolve({}, context(["task:read:department"], "d1"), txDept)) as { widgets: { trend?: number[]; value: number }[] };
    expect(deptResult.widgets[0]!.trend).toEqual([5]);
    expect((txDept as unknown as { analyticsSnapshot: { findMany: jest.Mock } }).analyticsSnapshot.findMany.mock.calls[0][0].where).toMatchObject({
      departmentId: "d1",
    });

    // A department-scope viewer with no department set falls through to "no
    // trend," never silently substituting the tenant-wide row.
    const txDeptless = withRoleLookup({ analyticsSnapshot: { findMany: jest.fn() } });
    const deptlessResult = (await dataSource.resolve({}, context(["task:read:department"], null), txDeptless)) as {
      widgets: { trend?: number[]; value: number }[];
    };
    expect(deptlessResult.widgets[0]!.trend).toBeUndefined();
    expect((txDeptless as unknown as { analyticsSnapshot: { findMany: jest.Mock } }).analyticsSnapshot.findMany).not.toHaveBeenCalled();

    // own/team/department-subtree: still a real, disclosed gap in Phase B —
    // value present, trend absent, no query issued.
    const txOwn = withRoleLookup({ analyticsSnapshot: { findMany: jest.fn() } });
    const ownResult = (await dataSource.resolve({}, context(["task:read:own"]), txOwn)) as { widgets: { trend?: number[]; value: number }[] };
    expect(ownResult.widgets[0]!.trend).toBeUndefined();
    expect(ownResult.widgets[0]!.value).toBe(42);
    expect((txOwn as unknown as { analyticsSnapshot: { findMany: jest.Mock } }).analyticsSnapshot.findMany).not.toHaveBeenCalled();
  });

  it("passes filter params through to each metric's computeLive", async () => {
    const registry = new MetricRegistry();
    const computeLive = jest.fn().mockResolvedValue(1);
    registry.register({ kind: "scalar", key: "filtered.metric", module: "Test", label: "filtered", format: "count", computeLive });
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup();

    await dataSource.resolve({ departmentId: "d1", employeeId: "u9" }, context([]), tx);
    expect(computeLive).toHaveBeenCalledWith(expect.anything(), tx, expect.objectContaining({ departmentId: "d1", employeeId: "u9" }));
  });

  it("resolves metrics sequentially against the shared tx, never in parallel", async () => {
    const registry = new MetricRegistry();
    const callOrder: string[] = [];
    registry.register({
      kind: "scalar",
      key: "first",
      module: "Test",
      label: "first",
      format: "count",
      computeLive: async () => {
        callOrder.push("first-start");
        await Promise.resolve();
        callOrder.push("first-end");
        return 1;
      },
    });
    registry.register({
      kind: "scalar",
      key: "second",
      module: "Test",
      label: "second",
      format: "count",
      computeLive: async () => {
        callOrder.push("second-start");
        return 2;
      },
    });
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup();

    await dataSource.resolve({}, context([]), tx);
    expect(callOrder).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("handles a breakdown metric alongside scalar metrics", async () => {
    const registry = new MetricRegistry();
    registry.register(breakdown("mix.breakdown", "task:read"));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup();

    const result = (await dataSource.resolve({}, context(["task:read:tenant"]), tx)) as { widgets: { kind: string; rows: unknown[] }[] };
    expect(result.widgets[0]).toMatchObject({ kind: "breakdown", rows: [{ name: "a", value: 1 }] });
  });

  it("returns layout from the caller's role-level DashboardLayout template when no personal layout exists", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("open.metric", undefined, 1));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const roleWidgets = [{ key: "open.metric", visible: true, x: 0, y: 0, w: 6, h: 4 }];
    const dashboardLayoutFindFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // personal lookup: none
      .mockResolvedValueOnce({ widgets: roleWidgets }); // role-level lookup: found
    const tx = {
      roleAssignment: { findFirst: jest.fn().mockResolvedValue({ roleId: "role-1" }) },
      dashboardLayout: { findFirst: dashboardLayoutFindFirst },
    } as unknown as PrismaTx;

    const result = (await dataSource.resolve({}, context([]), tx)) as { layout?: unknown };
    expect(result.layout).toEqual(roleWidgets);
    expect(dashboardLayoutFindFirst.mock.calls[0]![0].where).toMatchObject({ tenantId: "t1", userId: "u1", dashboardKey: "analytics", isActive: true });
    expect(dashboardLayoutFindFirst.mock.calls[1]![0].where).toMatchObject({ tenantId: "t1", roleId: "role-1", userId: null, dashboardKey: "analytics", isActive: true });
  });

  it("returns the caller's PERSONAL layout instead of the role template when both exist — personal takes priority", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("open.metric", undefined, 1));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const personalWidgets = [{ key: "open.metric", visible: true, x: 6, y: 0, w: 6, h: 4 }];
    const tx = {
      roleAssignment: { findFirst: jest.fn() },
      dashboardLayout: { findFirst: jest.fn().mockResolvedValue({ widgets: personalWidgets }) },
    } as unknown as PrismaTx;

    const result = (await dataSource.resolve({}, context([]), tx)) as { layout?: unknown };
    expect(result.layout).toEqual(personalWidgets);
    // The role-level lookup is never reached — personal short-circuits it.
    expect((tx as unknown as { roleAssignment: { findFirst: jest.Mock } }).roleAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("returns layout: undefined (not an error) for a caller with no personal layout, no role assignment, or no matching template — the pre-Phase-E tenant fallback", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("open.metric", undefined, 1));
    const dataSource = createAnalyticsDashboardDataSource(registry);

    const txNoRole = withRoleLookup();
    const noRoleResult = (await dataSource.resolve({}, context([]), txNoRole)) as { layout?: unknown };
    expect(noRoleResult.layout).toBeUndefined();

    const txNoTemplate = {
      roleAssignment: { findFirst: jest.fn().mockResolvedValue({ roleId: "role-1" }) },
      dashboardLayout: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    const noTemplateResult = (await dataSource.resolve({}, context([]), txNoTemplate)) as { layout?: unknown };
    expect(noTemplateResult.layout).toBeUndefined();
  });
});

describe("analytics.dashboard — composite metrics (Phase F)", () => {
  function composite(ingredients: string[]): CompositeMetricDefinition {
    return {
      kind: "composite",
      key: "composite.metric",
      module: "Cross-Module",
      label: "Composite",
      format: "percent",
      ingredients,
      combine: (values) => Math.round(((values["a.metric"] ?? 0) + (values["b.metric"] ?? 0)) / 2),
    };
  }

  it("is present, with the correct combine()-computed value, when the caller holds every ingredient's requiredPermission", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("a.metric", "task:read", 80));
    registry.register(gatedScalar("b.metric", "attendance:read", 60));
    registry.register(composite(["a.metric", "b.metric"]));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup();

    const result = (await dataSource.resolve({}, context(["task:read:own", "attendance:read:own"]), tx)) as {
      widgets: { key: string; kind: string; value: number }[];
    };
    const widget = result.widgets.find((w) => w.key === "composite.metric");
    expect(widget).toMatchObject({ kind: "scalar", value: 70 });
  });

  it("is absent when the caller is missing even one ingredient's permission", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("a.metric", "task:read", 80));
    registry.register(gatedScalar("b.metric", "attendance:read", 60));
    registry.register(composite(["a.metric", "b.metric"]));
    const dataSource = createAnalyticsDashboardDataSource(registry);
    const tx = withRoleLookup();

    // Holds task:read but NOT attendance:read.
    const result = (await dataSource.resolve({}, context(["task:read:own"]), tx)) as { widgets: { key: string }[] };
    expect(result.widgets.find((w) => w.key === "composite.metric")).toBeUndefined();
    // The ungated ingredient widget (a.metric, task:read) is still present —
    // per-widget pruning, not an all-or-nothing gate.
    expect(result.widgets.find((w) => w.key === "a.metric")).toBeDefined();
  });

  it("is never returned by analytics.trend, regardless of metricKey — confirms the existing kind !== 'scalar' guard still holds", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("a.metric", "task:read", 80));
    registry.register(gatedScalar("b.metric", "attendance:read", 60));
    registry.register(composite(["a.metric", "b.metric"]));
    const dataSource = createAnalyticsTrendDataSource(registry);
    const tx = {} as unknown as PrismaTx;

    const rows = await dataSource.resolve({ metricKey: "composite.metric", days: 90 }, context(["task:read:tenant", "attendance:read:tenant"]), tx);
    expect(rows).toEqual([]);
  });
});

describe("analytics.trend", () => {
  it("returns [] for an unknown metricKey", async () => {
    const registry = new MetricRegistry();
    const dataSource = createAnalyticsTrendDataSource(registry);
    const tx = {} as unknown as PrismaTx;
    expect(await dataSource.resolve({ metricKey: "ghost", days: 90 }, context(["task:read:tenant"]), tx)).toEqual([]);
  });

  it("returns [] for a metric with no snapshot capability", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("no.snapshot", "task:read", 1, false));
    const dataSource = createAnalyticsTrendDataSource(registry);
    const tx = {} as unknown as PrismaTx;
    expect(await dataSource.resolve({ metricKey: "no.snapshot", days: 90 }, context(["task:read:tenant"]), tx)).toEqual([]);
  });

  it("throws ForbiddenException when the actor lacks the metric's requiredPermission", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("gated.trend", "settings:manage", 1, true));
    const dataSource = createAnalyticsTrendDataSource(registry);
    const tx = {} as unknown as PrismaTx;
    await expect(dataSource.resolve({ metricKey: "gated.trend", days: 90 }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("throws ForbiddenException for a non-tenant-scope caller", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("scoped.trend", "task:read", 1, true));
    const dataSource = createAnalyticsTrendDataSource(registry);
    const tx = {} as unknown as PrismaTx;
    await expect(dataSource.resolve({ metricKey: "scoped.trend", days: 90 }, context(["task:read:department"]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("returns history rows for a tenant-scope caller", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("real.trend", "task:read", 1, true));
    const dataSource = createAnalyticsTrendDataSource(registry);
    const periodStart = new Date("2026-08-01");
    const tx = { analyticsSnapshot: { findMany: jest.fn().mockResolvedValue([{ periodStart, value: 10 }]) } } as unknown as PrismaTx;
    const rows = await dataSource.resolve({ metricKey: "real.trend", days: 90 }, context(["task:read:tenant"]), tx);
    expect(rows).toEqual([{ periodStart, value: 10 }]);
  });

  it("returns department-scoped history rows for a department-scope caller with a real department (Phase B)", async () => {
    const registry = new MetricRegistry();
    registry.register(gatedScalar("dept.trend", "task:read", 1, true));
    const dataSource = createAnalyticsTrendDataSource(registry);
    const periodStart = new Date("2026-08-01");
    const tx = { analyticsSnapshot: { findMany: jest.fn().mockResolvedValue([{ periodStart, value: 7 }]) } } as unknown as PrismaTx;
    const rows = await dataSource.resolve({ metricKey: "dept.trend", days: 90 }, context(["task:read:department"], "d1"), tx);
    expect(rows).toEqual([{ periodStart, value: 7 }]);
    expect((tx as unknown as { analyticsSnapshot: { findMany: jest.Mock } }).analyticsSnapshot.findMany.mock.calls[0][0].where).toMatchObject({
      departmentId: "d1",
    });
  });
});

describe("analytics.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("all false with no grants at all", async () => {
    const result = await analyticsCapabilitiesDataSource.resolve({}, context([]), tx);
    expect(result).toEqual({ canBrowseOrg: false, canBrowseProjects: false, canManageRoleTemplates: false });
  });

  it("canBrowseProjects true for a mid-tier role holding only project:read, the other two stay false", async () => {
    const result = await analyticsCapabilitiesDataSource.resolve({}, context(["project:read:team"]), tx);
    expect(result).toEqual({ canBrowseOrg: false, canBrowseProjects: true, canManageRoleTemplates: false });
  });

  it("canBrowseOrg true with only department:manage (user:manage absent)", async () => {
    const result = await analyticsCapabilitiesDataSource.resolve({}, context(["department:manage:tenant"]), tx);
    expect(result).toEqual({ canBrowseOrg: true, canBrowseProjects: false, canManageRoleTemplates: false });
  });

  it("canBrowseOrg true with only user:manage (department:manage absent)", async () => {
    const result = await analyticsCapabilitiesDataSource.resolve({}, context(["user:manage:tenant"]), tx);
    expect(result).toEqual({ canBrowseOrg: true, canBrowseProjects: false, canManageRoleTemplates: false });
  });

  it("canManageRoleTemplates true only when role:manage is held, independent of the other two", async () => {
    const result = await analyticsCapabilitiesDataSource.resolve({}, context(["role:manage:tenant"]), tx);
    expect(result).toEqual({ canBrowseOrg: false, canBrowseProjects: false, canManageRoleTemplates: true });
  });

  it("all true for a role holding all four (e.g. Company Admin)", async () => {
    const result = await analyticsCapabilitiesDataSource.resolve(
      {},
      context(["department:manage:tenant", "user:manage:tenant", "project:read:tenant", "role:manage:tenant"]),
      tx,
    );
    expect(result).toEqual({ canBrowseOrg: true, canBrowseProjects: true, canManageRoleTemplates: true });
  });
});
