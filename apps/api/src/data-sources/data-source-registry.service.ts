import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import type { EffectivePermissions } from "../rbac/permission-collapse";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";

export interface DataSourceContext {
  tenantId: string;
  userId: string;
  userDepartmentId: string | null;
  effective: EffectivePermissions;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry entries are necessarily heterogeneous; individual register() calls are still type-safe.
export interface DataSourceDefinition<P = any> {
  name: string;
  paramsSchema: z.ZodType<P>;
  /** "resource:action" — checked before resolving (presence only; a
   * resolver that needs row-level scope checks does that itself via
   * `ctx.effective.has()` + `isRowInScope()`, since only it knows which
   * rows are in play). Omit for sources with no permission gate. */
  requiredPermission?: string;
  resolve: (params: P, ctx: DataSourceContext, tx: PrismaTx) => Promise<unknown>;
}

/** Extracted from `DataSourcesController`'s own duplicated inline check
 * (its `resolve()` and `resolveBatch()` each had the identical 5-line
 * block) — Phase E (proactive digests) makes this a 3rd real call site
 * (`digest-content.ts` needs to skip `leaveRequestsPendingApprovalsDataSource`
 * for the common case of a user with no `leave:approve` grant, without
 * treating that as an error). Mirrors `checkRequiredPermission`'s own
 * extraction precedent in `mutation-registry.service.ts` — a boolean
 * predicate here rather than a throwing function, since the two controller
 * call sites want different behavior on failure (one throws, one pushes a
 * per-item `{error}`), and the digest use wants neither. */
export function hasRequiredPermission(def: Pick<DataSourceDefinition, "requiredPermission">, effective: EffectivePermissions): boolean {
  if (!def.requiredPermission) return true;
  const [resource, action] = def.requiredPermission.split(":");
  return effective.has(resource!, action!) !== null;
}

/**
 * In-process registry (NestJS provider, keyed by name), populated at boot
 * by each feature module — not a DB table (see CONTEXT.md gap-resolution
 * #7). `DataSourcesController` dispatches to whatever's registered here;
 * an unregistered name 404s regardless of how many sources exist.
 */
@Injectable()
export class DataSourceRegistry {
  private readonly sources = new Map<string, DataSourceDefinition>();

  register<P>(def: DataSourceDefinition<P>): void {
    if (this.sources.has(def.name)) {
      throw new Error(`Data source "${def.name}" is already registered`);
    }
    this.sources.set(def.name, def as DataSourceDefinition);
  }

  get(name: string): DataSourceDefinition | undefined {
    return this.sources.get(name);
  }
}
