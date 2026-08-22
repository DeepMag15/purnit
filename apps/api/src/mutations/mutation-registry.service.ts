import { ForbiddenException, Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { EffectivePermissions } from "../rbac/permission-collapse";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";

export interface MutationContext {
  tenantId: string;
  userId: string;
  userDepartmentId: string | null;
  effective: EffectivePermissions;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry entries are necessarily heterogeneous; individual register() calls are still type-safe.
export interface MutationDefinition<I = any, Pre = unknown> {
  name: string;
  inputSchema: z.ZodType<I>;
  /** "resource:action" — same presence-only gate as DataSourceDefinition;
   * row-level scope is the resolver's own job. */
  requiredPermission?: string;
  /**
   * Optional external I/O to run *before* the transaction opens (e.g. Meetings'
   * Daily.co room creation) — see the matching note in tenant-prisma.service.ts
   * on why no mutation could previously do "commit, then do X". Runs before the
   * requiredPermission check, so a zero-grant caller can still trigger one live
   * call before being 403'd and rolled back — accepted, documented trade-off,
   * not worth a second pre-check transaction.
   *
   * `authUserId` (added for the AI Assistant, Phase A) — the controller
   * already resolves this from `tenantContext.getOrThrow()` before opening
   * the transaction; threading it through lets a `preResolve` that needs an
   * *authorized* read before its external call (e.g. confirming a resource
   * is owned by the caller before including its private content in an LLM
   * request) do that read itself, scoped by tenant, rather than either
   * skipping the check or being unable to implement the mutation at all.
   */
  preResolve?: (input: I, ctx: { tenantId: string; authUserId: string }) => Promise<Pre>;
  /** Best-effort undo of preResolve's side effect if the transaction fails. Never rethrows. */
  rollbackPreResolve?: (pre: Pre) => Promise<void>;
  /** `pre` is optional at the type level purely so every pre-existing
   * `resolve(input, ctx, tx)` call site (every mutation spec file) keeps
   * compiling unchanged — it's always actually populated by the time a
   * mutation that declares `preResolve` runs (the controller guarantees the
   * order), so those mutations' own implementations use it via `pre!`. */
  resolve: (input: I, ctx: MutationContext, tx: PrismaTx, pre?: Pre) => Promise<unknown>;
}

/** Extracted from MutationsController's own inline check (Phase D) so
 * `aiToolCall.confirm` can re-run the exact same authorization logic against
 * a target mutation, rather than reimplementing it — the literal same code
 * path, not a parallel one. Behavior-identical to the controller's prior
 * inline block. */
export function checkRequiredPermission(def: Pick<MutationDefinition, "requiredPermission">, effective: EffectivePermissions): void {
  if (!def.requiredPermission) return;
  const [resource, action] = def.requiredPermission.split(":");
  if (effective.has(resource!, action!) === null) {
    throw new ForbiddenException(`Missing permission "${def.requiredPermission}"`);
  }
}

/** Same pattern as DataSourceRegistry — see its comment. */
@Injectable()
export class MutationRegistry {
  private readonly mutations = new Map<string, MutationDefinition>();

  // Parametrized over both `I` and `Pre` (not just `I`) — a `register()` call
  // for a mutation with a real `Pre` (e.g. Meetings' `CreatePre`) would
  // otherwise force `Pre` to its `unknown` default, and `rollbackPreResolve`'s
  // parameter type is contravariant, making `MutationDefinition<I, RealPre>`
  // not assignable to `MutationDefinition<I, unknown>`.
  register<I, Pre = unknown>(def: MutationDefinition<I, Pre>): void {
    if (this.mutations.has(def.name)) {
      throw new Error(`Mutation "${def.name}" is already registered`);
    }
    this.mutations.set(def.name, def as MutationDefinition);
  }

  get(name: string): MutationDefinition | undefined {
    return this.mutations.get(name);
  }
}
