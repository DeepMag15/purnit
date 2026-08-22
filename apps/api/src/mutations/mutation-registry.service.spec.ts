import { ForbiddenException } from "@nestjs/common";
import { z } from "zod";
import { MutationRegistry, checkRequiredPermission, type MutationDefinition } from "./mutation-registry.service";
import { collapsePermissions } from "../rbac/permission-collapse";

describe("MutationRegistry", () => {
  it("register/get round-trips a definition", () => {
    const registry = new MutationRegistry();
    const def: MutationDefinition = { name: "test.create", inputSchema: z.object({}), async resolve() {} };
    registry.register(def);
    expect(registry.get("test.create")).toBe(def);
  });

  it("get returns undefined for an unregistered name", () => {
    const registry = new MutationRegistry();
    expect(registry.get("ghost.mutation")).toBeUndefined();
  });

  it("register throws on a duplicate name", () => {
    const registry = new MutationRegistry();
    const def: MutationDefinition = { name: "test.create", inputSchema: z.object({}), async resolve() {} };
    registry.register(def);
    expect(() => registry.register(def)).toThrow('Mutation "test.create" is already registered');
  });
});

// Phase D — extracted from MutationsController's own inline check so
// aiToolCall.confirm can reuse the exact same authorization logic.
describe("checkRequiredPermission", () => {
  it("is a no-op when the definition has no requiredPermission", () => {
    expect(() => checkRequiredPermission({ requiredPermission: undefined }, collapsePermissions([]))).not.toThrow();
  });

  it("passes when the effective permissions grant the required resource:action", () => {
    const effective = collapsePermissions(["task:create:tenant"]);
    expect(() => checkRequiredPermission({ requiredPermission: "task:create" }, effective)).not.toThrow();
  });

  it("throws ForbiddenException when the required permission is not granted", () => {
    const effective = collapsePermissions([]);
    expect(() => checkRequiredPermission({ requiredPermission: "task:create" }, effective)).toThrow(ForbiddenException);
  });

  it("throws ForbiddenException when a different resource:action is granted", () => {
    const effective = collapsePermissions(["task:read:tenant"]);
    expect(() => checkRequiredPermission({ requiredPermission: "task:create" }, effective)).toThrow(ForbiddenException);
  });
});
