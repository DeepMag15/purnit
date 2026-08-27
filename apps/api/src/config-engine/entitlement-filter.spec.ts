import { filterByEntitlements, applyFeatureFlagOverrides } from "./entitlement-filter";
import type { BlueprintDefinition } from "@purnit/manifest-schema";

function sampleResolved(): BlueprintDefinition {
  return {
    id: "it",
    version: 1,
    industry: "IT",
    roles: [],
    departmentTypes: [],
    navigation: [
      { id: "nav.dashboard", label: "Dashboard", pageId: "page.dashboard" }, // no moduleKey => core
      { id: "nav.projects", label: "Projects", pageId: "page.projects", moduleKey: "projects" },
      { id: "nav.tasks", label: "Tasks", pageId: "page.tasks", moduleKey: "tasks" },
    ],
    dashboards: { default: "page.dashboard" },
    modules: ["projects", "tasks"],
    pages: {},
  };
}

describe("filterByEntitlements", () => {
  it("no plan assigned (null) => everything in the blueprint is entitled", () => {
    const resolved = sampleResolved();
    expect(filterByEntitlements(resolved, null)).toEqual(resolved);
  });

  it("drops modules and their nav items not in the entitled list", () => {
    const resolved = filterByEntitlements(sampleResolved(), ["projects"]);
    expect(resolved.modules).toEqual(["projects"]);
    expect(resolved.navigation.map((n) => n.id)).toEqual(["nav.dashboard", "nav.projects"]);
  });

  it("always keeps nav items with no moduleKey regardless of entitlements", () => {
    const resolved = filterByEntitlements(sampleResolved(), []);
    expect(resolved.navigation.map((n) => n.id)).toEqual(["nav.dashboard"]);
    expect(resolved.modules).toEqual([]);
  });
});

describe("applyFeatureFlagOverrides", () => {
  const allModuleKeys = ["projects", "tasks"];

  it("returns entitledModuleKeys unchanged when no flag matches any module key", () => {
    expect(applyFeatureFlagOverrides(allModuleKeys, ["projects"], { unrelated: true })).toEqual(["projects"]);
  });

  it("preserves the null fast path when no flag overrides anything", () => {
    expect(applyFeatureFlagOverrides(allModuleKeys, null, {})).toBeNull();
  });

  it("an explicit false flag removes a module even though the plan (null = everything) would allow it", () => {
    const result = applyFeatureFlagOverrides(allModuleKeys, null, { tasks: false });
    expect(result).not.toBeNull();
    expect(result).toEqual(["projects"]);
  });

  it("an explicit true flag adds a module back even though the plan excluded it", () => {
    const result = applyFeatureFlagOverrides(allModuleKeys, ["projects"], { tasks: true });
    expect(result).toEqual(expect.arrayContaining(["projects", "tasks"]));
    expect(result).toHaveLength(2);
  });

  it("a false flag on an already-excluded module is a no-op, not an error", () => {
    const result = applyFeatureFlagOverrides(allModuleKeys, ["projects"], { tasks: false });
    expect(result).toEqual(["projects"]);
  });

  it("a true flag on an already-included module is a no-op, not a duplicate", () => {
    const result = applyFeatureFlagOverrides(allModuleKeys, ["projects"], { projects: true });
    expect(result).toEqual(["projects"]);
  });
});
