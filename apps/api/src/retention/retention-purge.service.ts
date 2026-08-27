import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { TenantPrismaService } from "../tenancy/tenant-prisma.service";

/**
 * Go-Live, Phase 05 — the retention purge.
 *
 * Turns "deleted" into actually deleted. Without this, the Privacy Policy's
 * claim that removed data is "permanently purged after 30 days" would simply
 * be false — soft-deleted rows would sit in the database forever.
 *
 * ## Why this is written defensively
 *
 * This is the only code in the entire system that issues unconditional hard
 * deletes, and a mistake here destroys customer data with no undo. Every
 * design choice below is about bounding that blast radius:
 *
 * - **It only ever touches rows that carry an explicit `deletedAt` older than
 *   the window.** There is no "delete where not referenced", no cascade
 *   inference, and no cleverness. A row nobody explicitly deleted is never a
 *   candidate.
 * - **It runs once a day, not continuously.** A bug has hours of visibility
 *   in the logs before it can run twice.
 * - **It is disabled unless `RETENTION_PURGE_ENABLED` is set.** Defaulting a
 *   destructive background job to ON would mean any developer running the
 *   API against a copy of production data silently starts erasing it. Opting
 *   in is the only defensible default.
 * - **Dry-run mode reports exactly what it would delete without deleting.**
 *   That is how the job should be validated in a new environment before it is
 *   ever allowed to run for real.
 */

/** How long a soft-deleted row survives before it is destroyed. Matches the
 * window stated in the Privacy Policy — if this changes, that page changes
 * too, and they must not drift. */
export const RETENTION_DAYS = 30;

@Injectable()
export class RetentionPurgeService {
  private readonly logger = new Logger(RetentionPurgeService.name);
  private running = false;

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Off unless explicitly enabled. See the class comment for why. */
  static isEnabled(): boolean {
    return process.env.RETENTION_PURGE_ENABLED === "true";
  }

  /** Reports what would be purged without touching anything. */
  static isDryRun(): boolean {
    return process.env.RETENTION_PURGE_DRY_RUN === "true";
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async tick() {
    if (!RetentionPurgeService.isEnabled()) return;
    if (this.running) return;
    this.running = true;
    try {
      await this.purge();
    } catch (err) {
      this.logger.error("Retention purge failed", err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  /** Exposed for tests and for a deliberate manual run. */
  async purge(): Promise<{ cutoff: Date; dryRun: boolean; tenantsPurged: number; recordsPurged: number }> {
    const dryRun = RetentionPurgeService.isDryRun();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const result = { cutoff, dryRun, tenantsPurged: 0, recordsPurged: 0 };

    // ---- 1. Whole closed workspaces --------------------------------------
    // A tenant closed longer ago than the window takes everything it owns
    // with it. Done first so the per-record sweep below doesn't waste work on
    // rows that are about to disappear with their tenant anyway.
    const closedTenants = await this.tenantPrisma.root.tenant.findMany({
      where: { deletedAt: { not: null, lt: cutoff } },
      select: { id: true, name: true },
    });

    for (const tenant of closedTenants) {
      if (dryRun) {
        this.logger.warn(`[dry-run] would purge whole workspace ${tenant.id} (${tenant.name})`);
        result.tenantsPurged += 1;
        continue;
      }
      const deleted = await this.purgeTenant(tenant.id);
      result.recordsPurged += deleted;
      result.tenantsPurged += 1;
      this.logger.warn(`Purged closed workspace ${tenant.id} (${tenant.name}) — ${deleted} rows destroyed`);
    }

    // ---- 2. Individually soft-deleted records ----------------------------
    // Swept per tenant rather than in one cross-tenant query, because RLS
    // requires a tenant context to see any row at all (see
    // `purgeTenantRecords`). One extra round-trip per tenant per day is a
    // trivial cost for a job that would otherwise silently do nothing.
    const purgedIds = new Set(closedTenants.map((t) => t.id));
    const liveTenants = await this.tenantPrisma.root.tenant.findMany({
      where: { id: { notIn: [...purgedIds] } },
      select: { id: true },
    });

    for (const { id } of liveTenants) {
      result.recordsPurged += await this.purgeTenantRecords(id, cutoff, dryRun);
    }

    if (result.recordsPurged > 0 || result.tenantsPurged > 0) {
      this.logger.log(
        `${dryRun ? "[dry-run] " : ""}Retention purge complete: ${result.tenantsPurged} workspace(s), ` +
          `${result.recordsPurged} record(s) older than ${RETENTION_DAYS} days (cutoff ${cutoff.toISOString()})`,
      );
    }
    return result;
  }

  /**
   * Sweeps one tenant's expired soft-deleted rows.
   *
   * ⚠️ Runs inside `tenantPrisma.run(tenantId, …)`, NOT against `.root`.
   *
   * This is not a style preference — it is the difference between working and
   * silently doing nothing. `.root` connects as the restricted `app_runtime`
   * role (`NOBYPASSRLS`) with no `app.tenant_id` GUC set, so every row-level
   * security policy evaluates `tenant_id = NULL` and matches **zero rows**.
   * An earlier version of this job used `.root` and reported success while
   * destroying nothing: a closed workspace's tenant row disappeared (that
   * table has no RLS policy) while all 19 of its child rows survived as
   * orphans. Caught by checking the database afterwards rather than trusting
   * the job's own count.
   */
  private async purgeTenantRecords(tenantId: string, cutoff: Date, dryRun: boolean): Promise<number> {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      let total = 0;
      for (const model of PURGEABLE_MODELS) {
        const delegate = (tx as unknown as Record<string, unknown>)[model] as {
          count: (args: unknown) => Promise<number>;
          deleteMany: (args: unknown) => Promise<{ count: number }>;
        };
        const where = { deletedAt: { not: null, lt: cutoff } };

        if (dryRun) {
          const n = await delegate.count({ where });
          if (n > 0) this.logger.warn(`[dry-run] would purge ${n} ${model} row(s) in tenant ${tenantId}`);
          total += n;
          continue;
        }
        const { count } = await delegate.deleteMany({ where });
        if (count > 0) this.logger.log(`Purged ${count} ${model} row(s) in tenant ${tenantId}`);
        total += count;
      }
      return total;
    });
  }

  /**
   * Destroys one closed tenant entirely.
   *
   * Deliberately explicit about order and about what it touches, rather than
   * relying on database cascades — this codebase's foreign keys are
   * inconsistent by design (`users.department_id` carries no FK at all, per
   * ARCHITECTURE.md §8.1), so a cascade-based purge would leave orphans in
   * exactly the places that are hardest to notice.
   *
   * The child deletes run RLS-scoped (see `purgeTenantRecords` above for why);
   * only the final `tenants` row is removed through `.root`, which is correct
   * because that table is platform-root and carries no policy.
   */
  private async purgeTenant(tenantId: string): Promise<number> {
    const total = await this.tenantPrisma.run(tenantId, async (tx) => {
      let n = 0;
      for (const model of TENANT_OWNED_MODELS) {
        const delegate = (tx as unknown as Record<string, unknown>)[model] as {
          deleteMany: (args: unknown) => Promise<{ count: number }>;
        };
        const { count } = await delegate.deleteMany({ where: {} });
        n += count;
      }
      return n;
    });

    await this.tenantPrisma.root.tenant.delete({ where: { id: tenantId } });
    return total + 1;
  }
}

/**
 * Models whose individually soft-deleted rows are purged after the window.
 *
 * Ordered children-before-parents. `user` is deliberately LAST of the models
 * that other rows reference, so a task or comment referencing a deleted
 * person is gone before the person is.
 */
const PURGEABLE_MODELS = [
  "comment",
  "message",
  "task",
  "document",
  "calendarEvent",
  "announcement",
  "assignment",
  "contact",
  "invoice",
  "purchaseOrder",
  "workOrder",
  "inventoryItem",
  "supplier",
  "client",
  "student",
  "course",
  "patient",
  "project",
  "leaveType",
  "user",
] as const;

/**
 * ⚠️ `Department` and `Team` are deliberately ABSENT.
 *
 * They use `archivedAt`, not `deletedAt` — a reversible archive, not a
 * deletion. Purging an archived department would destroy data a customer
 * expects to be able to restore, and the archive has no expiry by design.
 *
 * This was a real bug caught by running the job rather than by reading it:
 * `department` was originally in this list (an earlier survey matched the
 * word `deletedAt` inside a *comment* in org.prisma), and Prisma rejected
 * the query with "Unknown argument `deletedAt`" — which would have thrown on
 * every single run and meant nothing was ever purged at all. The spec now
 * asserts this list against real field declarations.
 */
export const PURGEABLE_MODEL_NAMES: readonly string[] = PURGEABLE_MODELS;

/**
 * Every tenant-owned table, cleared when a whole workspace is purged.
 * Children before parents.
 *
 * ⚠️ **This list must gain an entry whenever a new tenant-scoped model is
 * added.** A model missing from here is not a crash — it is silently orphaned
 * data surviving a workspace deletion, which is precisely the failure a
 * privacy policy promises will not happen. There is a test that compares this
 * list against the live Prisma schema so the omission fails loudly instead.
 */
const TENANT_OWNED_MODELS = [
  // --- deepest children first ---
  "commentMention",
  "comment",
  // Contextual Reporting — before `document`, which it has an FK to. Ordering
  // here is load-bearing: this list is deleted top-down, so a child listed
  // after its parent fails the parent's delete and silently purges nothing.
  "documentAnalysis",
  "documentActivity",
  "documentVersion",
  "document",
  "grade",
  "assignment",
  "enrollment",
  "course",
  "student",
  "appointment",
  "patient",
  "payment",
  "invoice",
  "client",
  "bOMLine",
  "purchaseOrder",
  "workOrder",
  "inventoryItem",
  "supplier",
  "deal",
  "contact",
  "meetingParticipant",
  "meeting",
  "message",
  "conversationMember",
  "conversation",
  "announcement",
  "calendarReminder",
  "calendarEvent",
  "attendanceRecord",
  "leaveRequest",
  "leaveBalance",
  "leaveType",
  "aiToolCallProposal",
  "aiMessage",
  "aiConversation",
  "embedding",
  "embeddingJob",
  "projectMember",
  "task",
  "project",
  // --- tenant-level records with no children of their own ---
  "notification",
  "auditLog",
  "analyticsSnapshot",
  "dashboardLayout",
  "subscriptionEvent",
  "featureFlag",
  "ssoConfig",
  "tenantConfig",
  // --- identity and org structure, last ---
  "permissionDelegation",
  "roleAssignment",
  "departmentTypeRoleLabel",
  "role",
  "user",
  "team",
  "department",
] as const;

export const TENANT_OWNED_MODEL_NAMES: readonly string[] = TENANT_OWNED_MODELS;
