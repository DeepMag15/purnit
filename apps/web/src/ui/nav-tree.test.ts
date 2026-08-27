import { describe, it, expect } from "vitest";
import type { NavItem, WorkspaceManifest } from "@purnit/manifest-schema";
import { findNavPath } from "./nav-tree";

const manifest: WorkspaceManifest = {
  schemaVersion: 1,
  tenant: { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} },
  user: { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x", digestOptOut: false },
  navigation: [],
  page: { id: "page.dashboard", type: "Page", version: 1 },
  featureFlags: {},
  aiAvailable: false,
  meta: { compiledAt: "", etag: "x" },
};

const items: NavItem[] = [
  { id: "nav.dashboard", label: "Dashboard", pageId: "page.dashboard" },
  {
    id: "nav.hr-group",
    label: "HR",
    children: [{ id: "nav.employees", label: "Employees", pageId: "page.team" }],
  },
];

describe("findNavPath", () => {
  it("returns [] when the pathname isn't reachable from the tree at all", () => {
    expect(findNavPath(items, manifest, "/workspace/page.nowhere")).toEqual([]);
  });

  it("returns a single-element array for a top-level page", () => {
    expect(findNavPath(items, manifest, "/workspace")).toEqual([items[0]]);
  });

  it("returns the full root-to-leaf chain for a nested page", () => {
    const path = findNavPath(items, manifest, "/workspace/page.team");
    expect(path).toEqual([items[1], items[1]!.children![0]]);
  });

  it("matches via the resolved href, honoring the root-page special case (page.dashboard -> /workspace)", () => {
    // page.dashboard resolves to "/workspace", not "/workspace/page.dashboard" —
    // confirms this isn't a raw pageId string comparison.
    expect(findNavPath(items, manifest, "/workspace/page.dashboard")).toEqual([]);
    expect(findNavPath(items, manifest, "/workspace")).toEqual([items[0]]);
  });
});
