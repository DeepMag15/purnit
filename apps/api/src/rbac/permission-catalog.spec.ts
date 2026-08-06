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
});
