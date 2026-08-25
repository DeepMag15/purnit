import { z } from "zod";
import { MutationsController } from "./mutations.controller";
import { collapsePermissions } from "../rbac/permission-collapse";
import type { MutationRegistry } from "./mutation-registry.service";
import type { CurrentUserService } from "../tenancy/current-user.service";
import type { TenantContextService } from "../tenancy/tenant-context.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import type { PermissionResolverService } from "../rbac/permission-resolver.service";

/**
 * Unit-level coverage for the `preResolve`/`rollbackPreResolve` wiring —
 * originally added for Meetings' Daily.co room creation (see
 * mutation-registry.service.ts's doc comment). These hooks are no longer
 * hypothetical infrastructure: 10 mutations declare one today (the 6 billing
 * mutations, `tenant.closeWorkspace`, and the 3 AI ones), and each does real
 * external work there — which is precisely why the authorization ordering
 * below is load-bearing rather than incidental. Hand-rolled fakes for every
 * constructor dependency, same plain-object-mock style as every
 * `*.mutations.spec.ts` file in this codebase, rather than a full Nest
 * `TestingModule` (no precedent for that pattern anywhere in this project).
 */
function buildController(registeredDef: unknown, permissions: string[] = []) {
  const registry = { get: jest.fn().mockReturnValue(registeredDef) } as unknown as MutationRegistry;
  const currentUser = { getWithTx: jest.fn().mockResolvedValue({ id: "u1", mustChangePassword: false }) } as unknown as CurrentUserService;
  const tenantContext = { getOrThrow: jest.fn().mockReturnValue({ tenantId: "t1", authUserId: "au1" }) } as unknown as TenantContextService;
  const permissionResolver = {
    resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions(permissions)),
  } as unknown as PermissionResolverService;
  const tenantPrisma = { run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn({})) } as unknown as TenantPrismaService;

  return { controller: new MutationsController(registry, currentUser, tenantContext, tenantPrisma, permissionResolver), tenantPrisma };
}

describe("MutationsController — preResolve/rollbackPreResolve", () => {
  it("calls preResolve before opening the transaction and threads its result into resolve", async () => {
    const order: string[] = [];
    const def = {
      name: "test.mutation",
      inputSchema: z.object({}),
      async preResolve() {
        order.push("preResolve");
        return { roomId: "r1" };
      },
      async resolve(_input: unknown, _ctx: unknown, _tx: unknown, pre: unknown) {
        order.push("resolve");
        return { pre };
      },
    };
    const { controller, tenantPrisma } = buildController(def);
    (tenantPrisma.run as jest.Mock).mockImplementation((_tenantId, fn) => {
      order.push("run");
      return fn({});
    });

    const result = await controller.resolve("test.mutation", {});

    // The leading "run" is the authorization pre-flight: a mutation declaring
    // `preResolve` is authorized in its own short transaction *before* the
    // hook fires. This expectation previously read ["preResolve", "run",
    // "resolve"], which is exactly the ordering bug Stage E's write sweep
    // caught — see the controller's own comment.
    expect(order).toEqual(["run", "preResolve", "run", "resolve"]);
    expect(result).toEqual({ pre: { roomId: "r1" } });
  });

  it("refuses before preResolve runs when the caller lacks the permission", async () => {
    // The security property this ordering exists for: `billing.cancelSubscription`
    // calls Stripe inside `preResolve`, so a caller without `billing:manage`
    // must be turned away before the hook fires, not after.
    const preResolve = jest.fn();
    const def = {
      name: "billing.cancelSubscription",
      inputSchema: z.object({}),
      requiredPermission: "billing:manage",
      preResolve,
      async resolve() {
        return { ok: true };
      },
    };
    const { controller } = buildController(def, []);

    await expect(controller.resolve("billing.cancelSubscription", {})).rejects.toThrow('Missing permission "billing:manage"');
    expect(preResolve).not.toHaveBeenCalled();
  });

  it("still runs preResolve when the caller does hold the permission", async () => {
    const preResolve = jest.fn().mockResolvedValue({ cancelAt: null });
    const def = {
      name: "billing.cancelSubscription",
      inputSchema: z.object({}),
      requiredPermission: "billing:manage",
      preResolve,
      async resolve(_i: unknown, _c: unknown, _t: unknown, pre: unknown) {
        return { pre };
      },
    };
    const { controller } = buildController(def, ["billing:manage:tenant"]);

    const result = await controller.resolve("billing.cancelSubscription", {});
    expect(preResolve).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ pre: { cancelAt: null } });
  });

  it("does not add a pre-flight transaction for mutations with no preResolve", async () => {
    // The single-transaction consolidation (CONTEXT.md §47) must still hold
    // for the other 124 mutations — the pre-flight is scoped to the hook.
    const def = {
      name: "task.create",
      inputSchema: z.object({}),
      requiredPermission: "task:create",
      async resolve() {
        return { ok: true };
      },
    };
    const { controller, tenantPrisma } = buildController(def, ["task:create:own"]);

    await controller.resolve("task.create", {});
    expect((tenantPrisma.run as jest.Mock).mock.calls).toHaveLength(1);
  });

  it("calls rollbackPreResolve when the transaction fails, and still rethrows the original error", async () => {
    const rollback = jest.fn();
    const def = {
      name: "test.mutation",
      inputSchema: z.object({}),
      async preResolve() {
        return { roomId: "r1" };
      },
      async rollbackPreResolve(pre: unknown) {
        rollback(pre);
      },
      async resolve() {
        throw new Error("DB write failed");
      },
    };
    const { controller } = buildController(def);

    await expect(controller.resolve("test.mutation", {})).rejects.toThrow("DB write failed");
    expect(rollback).toHaveBeenCalledWith({ roomId: "r1" });
  });

  it("never calls rollbackPreResolve when the mutation succeeds", async () => {
    const rollback = jest.fn();
    const def = {
      name: "test.mutation",
      inputSchema: z.object({}),
      async preResolve() {
        return { roomId: "r1" };
      },
      async rollbackPreResolve(pre: unknown) {
        rollback(pre);
      },
      async resolve() {
        return { success: true };
      },
    };
    const { controller } = buildController(def);

    await controller.resolve("test.mutation", {});
    expect(rollback).not.toHaveBeenCalled();
  });

  it("a mutation with no preResolve behaves exactly as before (no pre, no rollback call on failure)", async () => {
    const def = {
      name: "test.mutation",
      inputSchema: z.object({}),
      async resolve(_input: unknown, _ctx: unknown, _tx: unknown, pre: unknown) {
        return { pre };
      },
    };
    const { controller } = buildController(def);

    const result = await controller.resolve("test.mutation", {});
    expect(result).toEqual({ pre: undefined });
  });
});
