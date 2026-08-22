import { applyGrantDeltas, resolveBlueprintRoles } from "./grant-resolution";
import type { BlueprintRoleDef } from "@purnit/manifest-schema";

describe("applyGrantDeltas", () => {
  it("adds a plain (unprefixed) delta as-is", () => {
    const result = applyGrantDeltas([], ["project:read:tenant"]);
    expect(result).toEqual(["project:read:tenant"]);
  });

  it("adds a '+'-prefixed delta on top of the base grants", () => {
    const base = ["project:read:tenant"];
    const result = applyGrantDeltas(base, ["+schedule:manage:team"]);
    expect(new Set(result)).toEqual(new Set(["project:read:tenant", "schedule:manage:team"]));
  });

  it("removes a '-'-prefixed delta that exactly matches a base grant", () => {
    const base = ["project:read:tenant", "patient:delete:tenant"];
    const result = applyGrantDeltas(base, ["-patient:delete:tenant"]);
    expect(result).toEqual(["project:read:tenant"]);
  });

  it("handles a mix of add and remove deltas together (the role.charge-nurse example shape)", () => {
    const base = ["schedule:manage:own", "patient:delete:tenant", "patient:read:tenant"];
    const deltas = ["+schedule:manage:team", "-patient:delete:tenant"];
    const result = applyGrantDeltas(base, deltas);
    expect(new Set(result)).toEqual(
      new Set(["schedule:manage:own", "schedule:manage:team", "patient:read:tenant"]),
    );
  });

  it("removing a grant that isn't present is a no-op", () => {
    const base = ["project:read:tenant"];
    const result = applyGrantDeltas(base, ["-nonexistent:action:own"]);
    expect(result).toEqual(["project:read:tenant"]);
  });

  it("does not mutate the base grants array", () => {
    const base = ["project:read:tenant"];
    applyGrantDeltas(base, ["+schedule:manage:team"]);
    expect(base).toEqual(["project:read:tenant"]);
  });
});

describe("resolveBlueprintRoles", () => {
  it("a role with no 'extends' keeps its own permissions verbatim", () => {
    const roles: BlueprintRoleDef[] = [{ id: "role.admin", label: "Admin", permissions: ["project:read:tenant", "task:read:tenant"] }];
    const resolved = resolveBlueprintRoles(roles);
    expect(resolved).toEqual([{ id: "role.admin", permissions: ["project:read:tenant", "task:read:tenant"] }]);
  });

  it("a simple 2-level chain applies the child's deltas on top of the parent's permissions", () => {
    const roles: BlueprintRoleDef[] = [
      { id: "role.nurse", label: "Nurse", permissions: ["schedule:manage:own", "patient:read:tenant"] },
      { id: "role.charge-nurse", label: "Charge Nurse", extends: "role.nurse", permissions: ["+schedule:manage:team"] },
    ];
    const resolved = resolveBlueprintRoles(roles);
    const chargeNurse = resolved.find((r) => r.id === "role.charge-nurse")!;
    expect(new Set(chargeNurse.permissions)).toEqual(new Set(["schedule:manage:own", "patient:read:tenant", "schedule:manage:team"]));
  });

  it("returns roles in dependency order — a role always appears after whatever it extends", () => {
    const roles: BlueprintRoleDef[] = [
      // Deliberately out of dependency order in the source array.
      { id: "role.senior", label: "Senior", extends: "role.base", permissions: ["+b:read:team"] },
      { id: "role.base", label: "Base", permissions: ["a:read:own"] },
    ];
    const order = resolveBlueprintRoles(roles).map((r) => r.id);
    expect(order.indexOf("role.base")).toBeLessThan(order.indexOf("role.senior"));
  });

  // Mirrors the actual IT blueprint's 6-level chain (seed.ts): each tier
  // extends the previous and adds a delta — proves multi-level (not just
  // 2-level) chains flatten correctly, including a scope-broadening add at
  // every step.
  it("resolves a full multi-level chain (the IT blueprint's intern -> department-head shape)", () => {
    const roles: BlueprintRoleDef[] = [
      { id: "role.intern", label: "Intern", permissions: ["task:read:own", "task:update:own"] },
      { id: "role.employee", label: "Employee", extends: "role.intern", permissions: ["+project:read:team", "+task:create:team"] },
      { id: "role.senior-employee", label: "Senior Employee", extends: "role.employee", permissions: ["+task:update:team"] },
      { id: "role.team-lead", label: "Team Lead", extends: "role.senior-employee", permissions: ["+project:update:team"] },
    ];
    const resolved = resolveBlueprintRoles(roles);
    const teamLead = resolved.find((r) => r.id === "role.team-lead")!;
    expect(new Set(teamLead.permissions)).toEqual(
      new Set(["task:read:own", "task:update:own", "project:read:team", "task:create:team", "task:update:team", "project:update:team"]),
    );
  });

  it("throws when a role extends an id that isn't in the roles array", () => {
    const roles: BlueprintRoleDef[] = [{ id: "role.child", label: "Child", extends: "role.ghost", permissions: [] }];
    expect(() => resolveBlueprintRoles(roles)).toThrow(/unknown role/);
  });

  it("throws on a circular extends chain", () => {
    const roles: BlueprintRoleDef[] = [
      { id: "role.a", label: "A", extends: "role.b", permissions: [] },
      { id: "role.b", label: "B", extends: "role.a", permissions: [] },
    ];
    expect(() => resolveBlueprintRoles(roles)).toThrow(/circular/i);
  });
});
