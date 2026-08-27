import { z } from "zod";
import { DataSourceRegistry, hasRequiredPermission, type DataSourceDefinition } from "./data-source-registry.service";
import { collapsePermissions } from "../rbac/permission-collapse";

describe("DataSourceRegistry", () => {
  it("register/get round-trips a definition", () => {
    const registry = new DataSourceRegistry();
    const def: DataSourceDefinition = { name: "test.list", paramsSchema: z.object({}), async resolve() {} };
    registry.register(def);
    expect(registry.get("test.list")).toBe(def);
  });

  it("get returns undefined for an unregistered name", () => {
    const registry = new DataSourceRegistry();
    expect(registry.get("ghost.list")).toBeUndefined();
  });

  it("register throws on a duplicate name", () => {
    const registry = new DataSourceRegistry();
    const def: DataSourceDefinition = { name: "test.list", paramsSchema: z.object({}), async resolve() {} };
    registry.register(def);
    expect(() => registry.register(def)).toThrow('Data source "test.list" is already registered');
  });
});

// Phase E — extracted from DataSourcesController's own duplicated inline
// check (resolve()/resolveBatch() each had the identical block) so
// digest-content.ts can reuse the exact same permission-presence logic.
describe("hasRequiredPermission", () => {
  it("returns true when the definition has no requiredPermission", () => {
    expect(hasRequiredPermission({ requiredPermission: undefined }, collapsePermissions([]))).toBe(true);
  });

  it("returns true when the effective permissions grant the required resource:action", () => {
    const effective = collapsePermissions(["leave:approve:tenant"]);
    expect(hasRequiredPermission({ requiredPermission: "leave:approve" }, effective)).toBe(true);
  });

  it("returns false when the required permission is not granted", () => {
    const effective = collapsePermissions([]);
    expect(hasRequiredPermission({ requiredPermission: "leave:approve" }, effective)).toBe(false);
  });

  it("returns false when a different resource:action is granted", () => {
    const effective = collapsePermissions(["leave:read:tenant"]);
    expect(hasRequiredPermission({ requiredPermission: "leave:approve" }, effective)).toBe(false);
  });
});
