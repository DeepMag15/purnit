import { isRowInScope } from "./scope-check";

describe("isRowInScope", () => {
  const actor = { userId: "u1", departmentId: "d1" };

  it("tenant scope allows any row", () => {
    expect(isRowInScope("tenant", {}, actor)).toBe(true);
    expect(isRowInScope("tenant", { ownerId: "someone-else", departmentId: "d2" }, actor)).toBe(true);
  });

  it("own scope requires ownerId to match the actor", () => {
    expect(isRowInScope("own", { ownerId: "u1" }, actor)).toBe(true);
    expect(isRowInScope("own", { ownerId: "u2" }, actor)).toBe(false);
    expect(isRowInScope("own", {}, actor)).toBe(false);
  });

  it("department scope requires departmentId to match the actor's department", () => {
    expect(isRowInScope("department", { departmentId: "d1" }, actor)).toBe(true);
    expect(isRowInScope("department", { departmentId: "d2" }, actor)).toBe(false);
    expect(isRowInScope("department", {}, actor)).toBe(false);
  });

  it("team scope behaves the same as department (no teamId column yet)", () => {
    expect(isRowInScope("team", { departmentId: "d1" }, actor)).toBe(true);
    expect(isRowInScope("team", { departmentId: "d2" }, actor)).toBe(false);
  });

  it("department/team scope with no departmentId on the actor never matches (unless they also own the row)", () => {
    const noDept = { userId: "u1", departmentId: null };
    expect(isRowInScope("department", { departmentId: "d1" }, noDept)).toBe(false);
  });

  // Regression tests for a real, user-reported bug: a task/project
  // assigned/owned by someone with only team/department scope was
  // invisible/un-actionable whenever the row's department didn't match —
  // even when they were the actual owner/assignee. Ownership must always
  // be sufficient under a broader scope, not just an alternative that
  // department match can override.
  it("department/team scope: owning the row is sufficient even with no department match at all", () => {
    expect(isRowInScope("department", { ownerId: "u1", departmentId: null }, actor)).toBe(true);
    expect(isRowInScope("team", { ownerId: "u1", departmentId: "some-other-dept" }, actor)).toBe(true);
  });

  it("department/team scope: owning the row is sufficient even when the actor has no department at all", () => {
    const noDept = { userId: "u1", departmentId: null };
    expect(isRowInScope("department", { ownerId: "u1", departmentId: null }, noDept)).toBe(true);
  });

  it("department/team scope: department match still works on its own when the actor doesn't own the row", () => {
    expect(isRowInScope("department", { ownerId: "someone-else", departmentId: "d1" }, actor)).toBe(true);
  });

  describe("department-subtree scope (Executive tier)", () => {
    const executive = { userId: "exec1", departmentId: "parent-dept", departmentSubtreeIds: ["parent-dept", "child-dept-1", "child-dept-2"] };

    it("matches a row in the actor's own department", () => {
      expect(isRowInScope("department-subtree", { departmentId: "parent-dept" }, executive)).toBe(true);
    });

    it("matches a row in a descendant department", () => {
      expect(isRowInScope("department-subtree", { departmentId: "child-dept-1" }, executive)).toBe(true);
    });

    it("does not match a row outside the subtree", () => {
      expect(isRowInScope("department-subtree", { departmentId: "unrelated-dept" }, executive)).toBe(false);
    });

    it("owning the row is sufficient even outside the subtree", () => {
      expect(isRowInScope("department-subtree", { ownerId: "exec1", departmentId: "unrelated-dept" }, executive)).toBe(true);
    });

    it("never matches when departmentSubtreeIds wasn't resolved (defensive default)", () => {
      const noSubtree = { userId: "exec1", departmentId: "parent-dept" };
      expect(isRowInScope("department-subtree", { departmentId: "child-dept-1" }, noSubtree)).toBe(false);
    });
  });
});
