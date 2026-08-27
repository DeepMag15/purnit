import { collapsePermissions } from "../../rbac/permission-collapse";
import { settingsCapabilitiesDataSource } from "./settings.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("settings.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("all false with no grants at all", async () => {
    const result = await settingsCapabilitiesDataSource.resolve({}, context([]), tx);
    expect(result).toEqual({ canManageSettings: false, canManageBilling: false, canManageFeatureFlags: false, canManageSso: false });
  });

  it("canManageSettings true with only settings:manage, the other three stay false", async () => {
    const result = await settingsCapabilitiesDataSource.resolve({}, context(["settings:manage:tenant"]), tx);
    expect(result).toEqual({ canManageSettings: true, canManageBilling: false, canManageFeatureFlags: false, canManageSso: false });
  });

  it("canManageBilling true with only billing:manage — a genuinely different resource from settings:manage", async () => {
    const result = await settingsCapabilitiesDataSource.resolve({}, context(["billing:manage:tenant"]), tx);
    expect(result).toEqual({ canManageSettings: false, canManageBilling: true, canManageFeatureFlags: false, canManageSso: false });
  });

  it("canManageFeatureFlags true with only featureFlag:manage", async () => {
    const result = await settingsCapabilitiesDataSource.resolve({}, context(["featureFlag:manage:tenant"]), tx);
    expect(result).toEqual({ canManageSettings: false, canManageBilling: false, canManageFeatureFlags: true, canManageSso: false });
  });

  it("canManageSso true with only sso:manage", async () => {
    const result = await settingsCapabilitiesDataSource.resolve({}, context(["sso:manage:tenant"]), tx);
    expect(result).toEqual({ canManageSettings: false, canManageBilling: false, canManageFeatureFlags: false, canManageSso: true });
  });

  it("all true for a role holding all four (e.g. Company Admin)", async () => {
    const result = await settingsCapabilitiesDataSource.resolve(
      {},
      context(["settings:manage:tenant", "billing:manage:tenant", "featureFlag:manage:tenant", "sso:manage:tenant"]),
      tx,
    );
    expect(result).toEqual({ canManageSettings: true, canManageBilling: true, canManageFeatureFlags: true, canManageSso: true });
  });
});
