import { collapsePermissions } from "../rbac/permission-collapse";
import { pruneByPermissions } from "./permission-pruner";
import type { BlueprintDefinition } from "@purnit/manifest-schema";

const ADMIN_PERMISSIONS = collapsePermissions([
  "project:read:tenant",
  "project:create:tenant",
  "project:delete:tenant",
]);

const MEMBER_PERMISSIONS = collapsePermissions(["project:read:team", "project:update:own"]);

const USER_MANAGER_PERMISSIONS = collapsePermissions(["user:manage:tenant"]);

function sampleResolved(): BlueprintDefinition {
  return {
    id: "it",
    version: 1,
    industry: "IT",
    roles: [],
    departmentTypes: [],
    navigation: [
      { id: "nav.dashboard", label: "Dashboard", pageId: "page.dashboard" },
      { id: "nav.projects", label: "Projects", pageId: "page.projects", requiredPermission: "project:read" },
      { id: "nav.admin-only", label: "Admin Zone", pageId: "page.admin", requiredPermission: "user:manage" },
      {
        id: "nav.group",
        label: "A Group",
        children: [{ id: "nav.group-child", label: "Group Child", pageId: "page.group-child", requiredPermission: "user:manage" }],
      },
    ],
    dashboards: { default: "page.dashboard" },
    modules: ["projects"],
    pages: {
      "page.projects": {
        id: "page.projects",
        type: "Page",
        version: 1,
        children: [
          {
            id: "projects-table",
            type: "Table",
            version: 2,
            actions: [
              { kind: "navigate", to: "page.project-detail" },
              { kind: "mutation", mutation: "project.create", input: { ref: "form" }, requiredPermission: "project:create" },
              { kind: "mutation", mutation: "project.delete", input: { ref: "row" }, requiredPermission: "project:delete" },
            ],
          },
        ],
      },
      "page.admin": {
        id: "page.admin",
        type: "Page",
        version: 1,
        requiredPermission: "user:manage",
        children: [],
      },
    },
  };
}

describe("pruneByPermissions", () => {
  it("Admin: sees nav/actions gated by permissions they hold; still lacks user:manage-gated nav", () => {
    const pruned = pruneByPermissions(sampleResolved(), ADMIN_PERMISSIONS);
    expect(pruned.navigation.map((n) => n.id)).toEqual(["nav.dashboard", "nav.projects"]); // admin-only requires user:manage, not granted in this fixture's ADMIN_PERMISSIONS
    const table = pruned.pages["page.projects"]!.children![0]!;
    expect(table.actions!.map((a) => (a as { mutation?: string }).mutation ?? a.kind)).toEqual([
      "navigate",
      "project.create",
      "project.delete",
    ]);
  });

  it("Member missing project:delete:tenant => the delete action is absent, not present-but-disabled", () => {
    const pruned = pruneByPermissions(sampleResolved(), MEMBER_PERMISSIONS);
    const table = pruned.pages["page.projects"]!.children![0]!;
    const actionIds = table.actions!.map((a) => (a as { mutation?: string }).mutation ?? a.kind);

    expect(actionIds).not.toContain("project.delete");
    expect(actionIds).not.toContain("project.create"); // Member also lacks project:create
    expect(actionIds).toEqual(["navigate"]);
    // Absent means literally not in the array — not e.g. `{ disabled: true }`.
    expect(table.actions!.some((a) => "mutation" in a && a.mutation === "project.delete")).toBe(false);
  });

  it("prunes a nav item whose required permission is missing entirely", () => {
    const noPermissions = collapsePermissions([]);
    const pruned = pruneByPermissions(sampleResolved(), noPermissions);
    expect(pruned.navigation.map((n) => n.id)).toEqual(["nav.dashboard"]);
  });

  it("keeps nav items with no requiredPermission regardless of grants", () => {
    const noPermissions = collapsePermissions([]);
    const pruned = pruneByPermissions(sampleResolved(), noPermissions);
    expect(pruned.navigation.some((n) => n.id === "nav.dashboard")).toBe(true);
  });

  it("drops a pure disclosure group entirely once every child is pruned away", () => {
    const noPermissions = collapsePermissions([]);
    const pruned = pruneByPermissions(sampleResolved(), noPermissions);
    expect(pruned.navigation.some((n) => n.id === "nav.group")).toBe(false);
  });

  it("keeps a pure disclosure group once at least one child survives pruning", () => {
    const pruned = pruneByPermissions(sampleResolved(), USER_MANAGER_PERMISSIONS);
    const group = pruned.navigation.find((n) => n.id === "nav.group");
    expect(group).toBeDefined();
    expect(group!.children!.map((c) => c.id)).toEqual(["nav.group-child"]);
  });

  it("a page whose own root requiredPermission isn't met is absent from pruned.pages, matching its absence from nav", () => {
    const noPermissions = collapsePermissions([]);
    const pruned = pruneByPermissions(sampleResolved(), noPermissions);
    expect(pruned.pages["page.admin"]).toBeUndefined();
  });

  it("a page whose own root requiredPermission is met is present in pruned.pages", () => {
    const pruned = pruneByPermissions(sampleResolved(), USER_MANAGER_PERMISSIONS);
    expect(pruned.pages["page.admin"]).toBeDefined();
  });

  it("onlyPageId (performance pass 2, CONTEXT.md §48): restricts pruned.pages to just that page, navigation unaffected", () => {
    const pruned = pruneByPermissions(sampleResolved(), ADMIN_PERMISSIONS, "page.projects");
    expect(Object.keys(pruned.pages)).toEqual(["page.projects"]);
    expect(pruned.pages["page.projects"]).toBeDefined();
    // Navigation still reflects the full, real permission set — onlyPageId
    // only restricts which *pages* get pruned/returned, not the nav tree.
    expect(pruned.navigation.map((n) => n.id)).toEqual(["nav.dashboard", "nav.projects"]);
  });

  it("onlyPageId for a page whose requiredPermission isn't met still omits it (same as the unrestricted case)", () => {
    const noPermissions = collapsePermissions([]);
    const pruned = pruneByPermissions(sampleResolved(), noPermissions, "page.admin");
    expect(pruned.pages["page.admin"]).toBeUndefined();
    expect(Object.keys(pruned.pages)).toEqual([]);
  });
});
