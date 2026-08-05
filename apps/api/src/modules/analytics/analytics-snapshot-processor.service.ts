import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { MetricRegistry, type ScalarMetricDefinition } from "../../metrics/metric-registry.service";

// Recomputing every 15 min keeps "today"'s point reasonably fresh without any
// per-row staleness bookkeeping — "stale" is simply "periodStart is today,"
// recomputed unconditionally on every tick. Self-heals if a tick is missed.
// Cheaper cadence than CalendarReminder's 60s (nothing user-facing depends
// on sub-minute freshness here) and than EmbeddingJob's 15s (tuned for
// RAG-freshness, not relevant to a dashboard trend line).
const POLL_INTERVAL_MS = 15 * 60_000;

/**
 * A scheduled recompute, deliberately not an outbox/job-queue like
 * EmbeddingJob/CalendarReminder — those exist because a mutation enqueues a
 * discrete, one-off unit of external work that must eventually happen
 * exactly once, with retries. Analytics snapshots are the opposite shape: a
 * fixed, always-the-same list of registered snapshot-capable metrics,
 * recomputed on a fixed schedule, where a missed/failed tick is harmless —
 * the next tick just recomputes the same "today" bucket fresh. Nothing to
 * enqueue, no status/attempts/backoff columns needed.
 */
@Injectable()
export class AnalyticsSnapshotProcessorService {
  private readonly logger = new Logger(AnalyticsSnapshotProcessorService.name);
  private running = false;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly metricRegistry: MetricRegistry,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processAllTenants();
    } catch (err) {
      this.logger.error("Analytics snapshot poll failed", err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async processAllTenants() {
    // Per-tenant round robin — identical idiom to CalendarReminderProcessorService:
    // RLS requires app.tenant_id set per call, so no single query can see
    // every tenant's due work at once.
    const tenants = await this.tenantPrisma.root.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.processTenant(tenant.id);
      } catch (err) {
        this.logger.warn(`Analytics snapshot recompute failed for tenant ${tenant.id}`, err instanceof Error ? err.stack : String(err));
      }
    }
  }

  private async processTenant(tenantId: string) {
    const today = startOfUtcDay(new Date());
    const snapshotMetrics = this.metricRegistry
      .list()
      .filter((m): m is ScalarMetricDefinition => m.kind === "scalar" && !!m.snapshot);

    // One shared tx per tenant per tick — sequential across metrics inside
    // it, same CONTEXT.md §9 discipline as calendar.list/attendance.roster:
    // never Promise.all against a shared transactional tx.
    await this.tenantPrisma.run(tenantId, async (tx) => {
      for (const metric of snapshotMetrics) {
        const rows = await metric.snapshot!.computeDaily(tenantId, tx);
        await tx.analyticsSnapshot.deleteMany({ where: { tenantId, metricKey: metric.key, periodStart: today } });
        if (rows.length > 0) {
          await tx.analyticsSnapshot.createMany({
            data: rows.map((r) => ({
              tenantId,
              metricKey: metric.key,
              departmentId: r.departmentId,
              value: r.value,
              periodStart: today,
              granularity: "day",
            })),
          });
        }
      }
    });
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
