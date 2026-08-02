import { applyKeyedListPatch, applyOverrides } from "./override-applier";
import type { BlueprintDefinition, NavItem } from "@antigravity/manifest-schema";

function sampleBlueprint(): BlueprintDefinition {
  return {
    id: "it",
    version: 1,
    industry: "IT",
    roles: [{ id: "role.admin", label: "Admin", permissions: ["project:read:tenant"] }],
    departmentTypes: [],
    navigation: [
      { id: "nav.dashboard", label: "Dashboard", pageId: "page.dashboard" },
      { id: "nav.projects", label: "Projects", pageId: "page.projects" },
    ],
    dashboards: { default: "page.dashboard" },
    modules: ["projects"],
    pages: {
      "page.dashboard": { id: "page.dashboard", type: "Page", version: 1, children: [] },
    },
  };
}

describe("applyKeyedListPatch", () => {
  const items: NavItem[] = [
    { id: "a", label: "A", pageId: "page.a" },
    { id: "b", label: "B", pageId: "page.b" },
    { id: "c", label: "C", pageId: "page.c" },
  ];

  it("removes items by id", () => {
    const result = applyKeyedListPatch(items, { remove: ["b"] });
    expect(result.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("patches a single item without touching others", () => {
    const result = applyKeyedListPatch(items, { patch: { b: { label: "Renamed B" } } });
    expect(result.find((i) => i.id === "b")?.label).toBe("Renamed B");
    expect(result.find((i) => i.id === "a")?.label).toBe("A");
    expect(result.find((i) => i.id === "c")?.label).toBe("C");
  });

  it("inserts a new item after a given anchor", () => {
    const result = applyKeyedListPatch(items, {
      add: [{ after: "a", item: { id: "new", label: "New", pageId: "page.new" } }],
    });
    expect(result.map((i) => i.id)).toEqual(["a", "new", "b", "c"]);
  });

  it("inserts a new item before a given anchor", () => {
    const result = applyKeyedListPatch(items, {
      add: [{ before: "c", item: { id: "new", label: "New", pageId: "page.new" } }],
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b", "new", "c"]);
  });

  it("falls back to appending at the end when the anchor id doesn't exist", () => {
    const result = applyKeyedListPatch(items, {
      add: [{ after: "nonexistent", item: { id: "new", label: "New", pageId: "page.new" } }],
    });
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c", "new"]);
  });

  it("returns the base list unchanged when no patch is given", () => {
    expect(applyKeyedListPatch(items, undefined)).toBe(items);
  });
});

describe("applyOverrides", () => {
  it("a nav-label patch changes only that item, leaving the rest of the blueprint untouched", () => {
    const blueprint = sampleBlueprint();
    const resolved = applyOverrides(blueprint, {
      navigation: { patch: { "nav.projects": { label: "Engineering Projects" } } },
    });

    expect(resolved.navigation.find((n) => n.id === "nav.projects")?.label).toBe("Engineering Projects");
    expect(resolved.navigation.find((n) => n.id === "nav.dashboard")?.label).toBe("Dashboard");
    expect(resolved.modules).toEqual(blueprint.modules);
    expect(resolved.pages).toEqual(blueprint.pages);
  });

  it("patches a page's children via the same keyed-patch mechanism", () => {
    const blueprint = sampleBlueprint();
    blueprint.pages["page.dashboard"]!.children = [
      { id: "widget.revenue", type: "KpiCard", version: 1 },
      { id: "widget.tasks", type: "KpiCard", version: 1 },
    ];

    const resolved = applyOverrides(blueprint, {
      pages: { patch: { "page.dashboard": { children: { remove: ["widget.revenue"] } } } },
    });

    expect(resolved.pages["page.dashboard"]!.children!.map((c) => c.id)).toEqual(["widget.tasks"]);
  });

  it("silently skips an override targeting an unknown page id", () => {
    const blueprint = sampleBlueprint();
    expect(() =>
      applyOverrides(blueprint, { pages: { patch: { "page.nonexistent": { children: { remove: ["x"] } } } } }),
    ).not.toThrow();
  });

  it("adds tenant-custom roles on top of the blueprint's roles", () => {
    const blueprint = sampleBlueprint();
    const resolved = applyOverrides(blueprint, {
      roles: { add: [{ id: "role.custom", label: "Custom", permissions: ["task:read:team"] }] },
    });
    expect(resolved.roles.map((r) => r.id)).toEqual(["role.admin", "role.custom"]);
  });
});
