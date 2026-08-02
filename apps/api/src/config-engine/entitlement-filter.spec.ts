import { filterByEntitlements } from "./entitlement-filter";
import type { BlueprintDefinition } from "@antigravity/manifest-schema";

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
