import { collapsePermissions } from "./permission-collapse";
import { isPermissionGranted } from "./permission-gate";

describe("isPermissionGranted", () => {
  it("returns true when requiredPermission is absent", () => {
    expect(isPermissionGranted(undefined, collapsePermissions([]))).toBe(true);
  });

  it("returns true when the actor holds the required resource:action at any scope", () => {
    expect(isPermissionGranted("task:read", collapsePermissions(["task:read:own"]))).toBe(true);
  });

  it("returns false when the actor doesn't hold the required resource:action", () => {
    expect(isPermissionGranted("task:read", collapsePermissions(["project:read:tenant"]))).toBe(false);
  });
});
