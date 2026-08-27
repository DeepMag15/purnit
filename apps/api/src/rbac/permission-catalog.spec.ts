import { isKnownPermission } from "./permission-catalog";

describe("permission-catalog", () => {
  it("knows the Analytics Phase D permission-controlled widget triples", () => {
    expect(isKnownPermission("analytics", "departmentPerformance")).toBe(true);
    expect(isKnownPermission("analytics", "productivity")).toBe(true);
    expect(isKnownPermission("analytics", "aiUsage")).toBe(true);
  });

  it("does not know an unrelated made-up triple", () => {
    expect(isKnownPermission("analytics", "financial")).toBe(false);
  });

  it("knows the Stripe Billing permission", () => {
    expect(isKnownPermission("billing", "manage")).toBe(true);
  });

  it("knows the Feature Flags permission", () => {
    expect(isKnownPermission("featureFlag", "manage")).toBe(true);
  });

  it("knows the Enterprise SSO permission", () => {
    expect(isKnownPermission("sso", "manage")).toBe(true);
  });
});
