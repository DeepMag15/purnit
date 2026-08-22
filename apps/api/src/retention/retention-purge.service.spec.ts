import fs from "node:fs";
import path from "node:path";
import { PURGEABLE_MODEL_NAMES, RETENTION_DAYS, RetentionPurgeService, TENANT_OWNED_MODEL_NAMES } from "./retention-purge.service";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";

/**
 * Reads the Prisma schema directly rather than importing the generated
 * client, so the assertion is against the source of truth a developer edits.
 */
function modelsWithTenantId(): string[] {
  const dir = path.resolve(__dirname, "../../prisma/schema");
  const models = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".prisma"))) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    let current: string | null = null;
    for (const line of content.split("\n")) {
      const modelMatch = /^model\s+(\w+)/.exec(line);
      if (modelMatch) current = modelMatch[1]!;
      else if (/^\}/.test(line)) current = null;
      else if (current && /^\s+tenantId\s/.test(line)) {
        // Prisma lowercases only the first character for the client property.
        models.add(current.charAt(0).toLowerCase() + current.slice(1));
        current = null;
      }
    }
  }
  return [...models].sort();
}

/** Models declaring a real `deletedAt` FIELD — not merely mentioning the word
 * in a comment, which is exactly the mistake that shipped a broken purge. */
function modelsWithDeletedAtField(): string[] {
  const dir = path.resolve(__dirname, "../../prisma/schema");
  const models = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".prisma"))) {
    let current: string | null = null;
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
      const modelMatch = /^model\s+(\w+)/.exec(line);
      if (modelMatch) current = modelMatch[1]!;
      else if (/^\}/.test(line)) current = null;
      else if (current && /^\s+deletedAt\s+DateTime/.test(line)) {
        models.add(current.charAt(0).toLowerCase() + current.slice(1));
      }
    }
  }
  return [...models].sort();
}

describe("PURGEABLE_MODELS", () => {
  /**
   * Regression guard for a real bug.
   *
   * `department` was originally listed here because an earlier survey matched
   * `deletedAt` inside a code *comment* in org.prisma. Department actually
   * uses `archivedAt`, so Prisma rejected the query with "Unknown argument
   * `deletedAt`" — which would have thrown on every run, meaning nothing was
   * ever purged and the retention promise was quietly false.
   */
  it("only lists models that really declare a deletedAt field", () => {
    const real = modelsWithDeletedAtField();
    const bogus = PURGEABLE_MODEL_NAMES.filter((m) => !real.includes(m));
    expect(bogus).toEqual([]);
  });

  it("covers every soft-deletable model except the tenant itself", () => {
    // `tenant` is handled by the whole-workspace path, not the record sweep.
    const expected = modelsWithDeletedAtField().filter((m) => m !== "tenant");
    const missing = expected.filter((m) => !PURGEABLE_MODEL_NAMES.includes(m));
    expect(missing).toEqual([]);
  });

  it("never purges the reversible archives", () => {
    // Department and Team use archivedAt deliberately — an archive a customer
    // can undo, with no expiry. Purging them would destroy restorable data.
    expect(PURGEABLE_MODEL_NAMES).not.toContain("department");
    expect(PURGEABLE_MODEL_NAMES).not.toContain("team");
  });
});

describe("TENANT_OWNED_MODELS", () => {
  /**
   * The guard promised in the service's own comment.
   *
   * A tenant-scoped model missing from the purge list is not a crash — it is
   * silently orphaned customer data surviving a workspace deletion, which is
   * exactly what the Privacy Policy promises will not happen. Adding a model
   * and forgetting this list is an easy, invisible mistake; this makes it a
   * loud one.
   */
  it("covers every model that carries a tenantId", () => {
    const missing = modelsWithTenantId().filter((m) => !TENANT_OWNED_MODEL_NAMES.includes(m));
    expect(missing).toEqual([]);
  });

  it("lists no model that doesn't exist", () => {
    const real = modelsWithTenantId();
    const phantom = TENANT_OWNED_MODEL_NAMES.filter((m) => !real.includes(m));
    expect(phantom).toEqual([]);
  });

  it("deletes children before the identity rows they reference", () => {
    const order = TENANT_OWNED_MODEL_NAMES;
    // `user`, `role` and `department` are referenced across the whole schema,
    // so they must come after the records pointing at them or a foreign key
    // blocks the delete mid-purge and leaves a half-destroyed tenant.
    for (const child of ["task", "comment", "roleAssignment", "message", "leaveRequest"]) {
      expect(order.indexOf(child)).toBeLessThan(order.indexOf("user"));
    }
    expect(order.indexOf("roleAssignment")).toBeLessThan(order.indexOf("role"));
    expect(order.indexOf("team")).toBeLessThan(order.indexOf("department"));
  });
});

describe("RetentionPurgeService safety switches", () => {
  const original = { enabled: process.env.RETENTION_PURGE_ENABLED, dry: process.env.RETENTION_PURGE_DRY_RUN };
  afterEach(() => {
    if (original.enabled === undefined) delete process.env.RETENTION_PURGE_ENABLED;
    else process.env.RETENTION_PURGE_ENABLED = original.enabled;
    if (original.dry === undefined) delete process.env.RETENTION_PURGE_DRY_RUN;
    else process.env.RETENTION_PURGE_DRY_RUN = original.dry;
  });

  it("is DISABLED by default", () => {
    // A destructive background job that defaults to ON would silently start
    // erasing data on any developer machine pointed at a copy of production.
    delete process.env.RETENTION_PURGE_ENABLED;
    expect(RetentionPurgeService.isEnabled()).toBe(false);
  });

  it("only enables on the exact string 'true'", () => {
    for (const value of ["1", "yes", "TRUE", "on", ""]) {
      process.env.RETENTION_PURGE_ENABLED = value;
      expect(RetentionPurgeService.isEnabled()).toBe(false);
    }
    process.env.RETENTION_PURGE_ENABLED = "true";
    expect(RetentionPurgeService.isEnabled()).toBe(true);
  });

  it("does nothing at all when disabled, even if the cron fires", async () => {
    delete process.env.RETENTION_PURGE_ENABLED;
    const root = new Proxy(
      {},
      {
        get() {
          throw new Error("The purge touched the database while disabled");
        },
      },
    );
    const service = new RetentionPurgeService({ root } as unknown as TenantPrismaService);
    await expect(service.tick()).resolves.toBeUndefined();
  });

  it("keeps the retention window aligned with what the Privacy Policy states", () => {
    // If this changes, /legal/privacy changes too — they must not drift.
    expect(RETENTION_DAYS).toBe(30);
  });
});

describe("RetentionPurgeService.purge", () => {
  const original = { enabled: process.env.RETENTION_PURGE_ENABLED, dry: process.env.RETENTION_PURGE_DRY_RUN };
  afterEach(() => {
    if (original.enabled === undefined) delete process.env.RETENTION_PURGE_ENABLED;
    else process.env.RETENTION_PURGE_ENABLED = original.enabled;
    if (original.dry === undefined) delete process.env.RETENTION_PURGE_DRY_RUN;
    else process.env.RETENTION_PURGE_DRY_RUN = original.dry;
  });

  function fakePrisma(params: { closedTenants?: { id: string; name: string }[]; liveTenants?: { id: string }[]; countPerModel?: number }) {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const count = jest.fn().mockResolvedValue(params.countPerModel ?? 0);
    const tenantDelete = jest.fn().mockResolvedValue({});
    const runTenantIds: string[] = [];

    let findManyCall = 0;
    const root = {
      tenant: {
        // First call fetches closed tenants; second fetches live ones.
        findMany: jest.fn().mockImplementation(() => {
          findManyCall += 1;
          return Promise.resolve(findManyCall === 1 ? (params.closedTenants ?? []) : (params.liveTenants ?? []));
        }),
        delete: tenantDelete,
      },
    } as unknown as Record<string, unknown>;

    // The RLS-scoped transaction client — every tenant-owned delete must go
    // through here, never through `root`.
    const tx = new Proxy({} as Record<string, unknown>, { get: () => ({ deleteMany, count }) });

    const prisma = {
      root,
      run: jest.fn((tenantId: string, fn: (t: unknown) => unknown) => {
        runTenantIds.push(tenantId);
        return fn(tx);
      }),
    } as unknown as TenantPrismaService;

    return { prisma, deleteMany, count, tenantDelete, runTenantIds };
  }

  it("only ever targets rows with an explicit deletedAt older than the cutoff", async () => {
    const { prisma, deleteMany } = fakePrisma({ liveTenants: [{ id: "live-1" }] });
    await new RetentionPurgeService(prisma).purge();

    // Every single delete must be bounded. An unbounded deleteMany in the
    // record sweep would erase live customer data.
    for (const call of deleteMany.mock.calls) {
      expect(call[0].where.deletedAt).toEqual({ not: null, lt: expect.any(Date) });
    }
    expect(deleteMany).toHaveBeenCalled();
  });

  /**
   * Regression guard for the most serious bug in this phase.
   *
   * The first version swept via `tenantPrisma.root`, which connects as the
   * restricted `app_runtime` role with no `app.tenant_id` GUC set. Every RLS
   * policy therefore matched zero rows: the job reported success while
   * destroying nothing, leaving a "deleted" workspace's 19 child rows alive as
   * orphans. Only the `tenants` row actually vanished, because that table has
   * no RLS policy.
   */
  it("performs every tenant-owned delete inside an RLS-scoped transaction, never via root", async () => {
    const { prisma, runTenantIds } = fakePrisma({
      closedTenants: [{ id: "closed-1", name: "Closed Co" }],
      liveTenants: [{ id: "live-1" }],
    });
    await new RetentionPurgeService(prisma).purge();

    // Both the whole-workspace purge and the per-tenant sweep must have opened
    // a scoped transaction for their tenant.
    expect(runTenantIds).toContain("closed-1");
    expect(runTenantIds).toContain("live-1");
    expect(prisma.run).toHaveBeenCalled();
  });

  it("sweeps each live tenant separately, because RLS makes a cross-tenant sweep return nothing", async () => {
    const { prisma, runTenantIds } = fakePrisma({ liveTenants: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    await new RetentionPurgeService(prisma).purge();
    expect(runTenantIds).toEqual(["a", "b", "c"]);
  });

  it("computes the cutoff from the retention window", async () => {
    const { prisma } = fakePrisma({});
    const before = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { cutoff } = await new RetentionPurgeService(prisma).purge();
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000 + 5000);
  });

  it("destroys nothing in dry-run mode", async () => {
    process.env.RETENTION_PURGE_DRY_RUN = "true";
    const { prisma, deleteMany, tenantDelete, count } = fakePrisma({
      closedTenants: [{ id: "t1", name: "Closed Co" }],
      liveTenants: [{ id: "live-1" }],
      countPerModel: 7,
    });

    const result = await new RetentionPurgeService(prisma).purge();

    expect(result.dryRun).toBe(true);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(tenantDelete).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalled();
    // Still reports what it would have done — that is the point of dry-run.
    expect(result.tenantsPurged).toBe(1);
    expect(result.recordsPurged).toBeGreaterThan(0);
  });

  it("purges a closed workspace across every tenant-owned model", async () => {
    const { prisma, deleteMany, tenantDelete } = fakePrisma({ closedTenants: [{ id: "t1", name: "Closed Co" }] });
    await new RetentionPurgeService(prisma).purge();

    // Inside the scoped transaction the tenant filter is implicit (RLS
    // supplies it), so the whole-workspace deletes carry an empty where.
    const wholeTenant = deleteMany.mock.calls.filter((c) => Object.keys(c[0].where ?? {}).length === 0);
    expect(wholeTenant.length).toBe(TENANT_OWNED_MODEL_NAMES.length);
    expect(tenantDelete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });

  it("excludes already-purged tenants from the live-tenant sweep, avoiding double work", async () => {
    const { prisma } = fakePrisma({ closedTenants: [{ id: "t1", name: "Closed Co" }] });
    await new RetentionPurgeService(prisma).purge();

    const findMany = (prisma.root as unknown as { tenant: { findMany: jest.Mock } }).tenant.findMany;
    expect(findMany.mock.calls[1]![0]).toEqual({ where: { id: { notIn: ["t1"] } }, select: { id: true } });
  });
});
