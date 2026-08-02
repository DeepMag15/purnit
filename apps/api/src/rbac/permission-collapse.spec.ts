import { collapsePermissions } from "./permission-collapse";

describe("collapsePermissions", () => {
  it("collapses to the broadest granted scope for the same resource:action", () => {
    const effective = collapsePermissions(["project:read:own", "project:read:team"]);
    expect(effective.has("project", "read")).toBe("team");
  });

  it("keeps distinct resource:action pairs independent", () => {
    const effective = collapsePermissions(["project:read:tenant", "task:create:team"]);
    expect(effective.has("project", "read")).toBe("tenant");
    expect(effective.has("task", "create")).toBe("team");
  });

  it("returns null for a resource:action with no grant", () => {
    const effective = collapsePermissions(["project:read:own"]);
    expect(effective.has("project", "delete")).toBeNull();
  });

  it("broadest-scope collapse is order-independent", () => {
    const a = collapsePermissions(["project:read:own", "project:read:tenant", "project:read:team"]);
    const b = collapsePermissions(["project:read:tenant", "project:read:team", "project:read:own"]);
    expect(a.has("project", "read")).toBe("tenant");
    expect(b.has("project", "read")).toBe("tenant");
  });

  describe("permissionsHash", () => {
    it("is stable regardless of input grant order", () => {
      const a = collapsePermissions(["project:read:tenant", "task:create:team"]);
      const b = collapsePermissions(["task:create:team", "project:read:tenant"]);
      expect(a.permissionsHash).toBe(b.permissionsHash);
    });

    it("changes when a grant is added", () => {
      const before = collapsePermissions(["project:read:own"]);
      const after = collapsePermissions(["project:read:own", "task:create:team"]);
      expect(after.permissionsHash).not.toBe(before.permissionsHash);
    });

    it("changes when a grant's scope broadens", () => {
      const before = collapsePermissions(["project:read:own"]);
      const after = collapsePermissions(["project:read:tenant"]);
      expect(after.permissionsHash).not.toBe(before.permissionsHash);
    });

    it("changes when a grant is removed", () => {
      const before = collapsePermissions(["project:read:own", "task:create:team"]);
      const after = collapsePermissions(["project:read:own"]);
      expect(after.permissionsHash).not.toBe(before.permissionsHash);
    });
  });

  it("rejects a malformed permission string", () => {
    expect(() => collapsePermissions(["not-a-valid-triple"])).toThrow();
  });

  it("rejects an unknown scope", () => {
    expect(() => collapsePermissions(["project:read:galaxy"])).toThrow();
  });
});
