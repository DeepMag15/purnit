import { isRoleAssignable } from "./role-hierarchy";

// Mirrors the real IT blueprint's chain (seed.ts): intern <- employee <-
// senior-employee <- team-lead <- project-manager <- department-head, plus
// hr-manager as a separate branch off employee. "admin" is intentionally
// absent from this map — Company Admin doesn't extend anything, it's
// handled entirely by the `actorIsAdmin` bypass.
const parentById = new Map<string, string | null>([
  ["intern", null],
  ["employee", "intern"],
  ["senior-employee", "employee"],
  ["team-lead", "senior-employee"],
  ["project-manager", "team-lead"],
  ["department-head", "project-manager"],
  ["hr-manager", "employee"],
]);

describe("isRoleAssignable", () => {
  it("Company Admin can assign anything, including a role with no ancestry relationship at all", () => {
    expect(isRoleAssignable(true, [], "department-head", parentById)).toBe(true);
    expect(isRoleAssignable(true, [], "unknown-role", parentById)).toBe(true);
  });

  it("a role can assign itself", () => {
    expect(isRoleAssignable(false, ["team-lead"], "team-lead", parentById)).toBe(true);
  });

  it("a role can assign any of its own ancestors", () => {
    expect(isRoleAssignable(false, ["team-lead"], "senior-employee", parentById)).toBe(true);
    expect(isRoleAssignable(false, ["team-lead"], "employee", parentById)).toBe(true);
    expect(isRoleAssignable(false, ["team-lead"], "intern", parentById)).toBe(true);
  });

  it("a role cannot assign a role above it in its own chain", () => {
    expect(isRoleAssignable(false, ["team-lead"], "project-manager", parentById)).toBe(false);
    expect(isRoleAssignable(false, ["team-lead"], "department-head", parentById)).toBe(false);
  });

  // The real-world consequence of hr-manager branching off employee rather
  // than off department-head: hr-manager's own chain never reaches
  // senior-employee/team-lead/etc, so it cannot assign them even though
  // they might sound "lower" in a casual reading of the org chart.
  it("a role cannot assign a role on a different branch, even one that sounds lower-tier", () => {
    expect(isRoleAssignable(false, ["hr-manager"], "senior-employee", parentById)).toBe(false);
    expect(isRoleAssignable(false, ["hr-manager"], "team-lead", parentById)).toBe(false);
  });

  it("hr-manager can assign itself and its own ancestors (employee, intern)", () => {
    expect(isRoleAssignable(false, ["hr-manager"], "hr-manager", parentById)).toBe(true);
    expect(isRoleAssignable(false, ["hr-manager"], "employee", parentById)).toBe(true);
    expect(isRoleAssignable(false, ["hr-manager"], "intern", parentById)).toBe(true);
  });

  it("a non-admin actor with no matching role at all cannot assign an unrelated role", () => {
    expect(isRoleAssignable(false, ["intern"], "employee", parentById)).toBe(false);
  });

  it("an actor holding multiple roles can assign anything reachable from any of them", () => {
    expect(isRoleAssignable(false, ["hr-manager", "team-lead"], "senior-employee", parentById)).toBe(true);
  });
});
