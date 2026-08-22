import { resolveTenantProviderOverride } from "./resolve-tenant-provider";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

describe("resolveTenantProviderOverride", () => {
  it("returns null when there's no active TenantConfig row at all", async () => {
    const tx = { tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    expect(await resolveTenantProviderOverride(tx, "t1")).toBeNull();
  });

  it("returns null when the active row's overrides has no 'ai' key", async () => {
    const tx = { tenantConfig: { findFirst: jest.fn().mockResolvedValue({ overrides: { navigation: {} } }) } } as unknown as PrismaTx;
    expect(await resolveTenantProviderOverride(tx, "t1")).toBeNull();
  });

  it("returns the tenant's chosen provider when set", async () => {
    const tx = { tenantConfig: { findFirst: jest.fn().mockResolvedValue({ overrides: { ai: { provider: "openai" } } }) } } as unknown as PrismaTx;
    expect(await resolveTenantProviderOverride(tx, "t1")).toBe("openai");
  });

  it("queries only the active row for the given tenant", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const tx = { tenantConfig: { findFirst } } as unknown as PrismaTx;
    await resolveTenantProviderOverride(tx, "t1");
    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: "t1", isActive: true }, select: { overrides: true } });
  });
});
