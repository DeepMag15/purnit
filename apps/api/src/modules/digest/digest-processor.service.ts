import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import { EmailService } from "../../email/email.service";
import { PermissionResolverService } from "../../rbac/permission-resolver.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { gatherDigestData, buildDigestSummary, type DigestSummary } from "./digest-content";

// A once-daily digest has no sub-30-minute freshness requirement — nothing
// user-facing needs second- or minute-granularity reaction to a UTC-midnight
// boundary. 30 min sits between CalendarReminder's 60s (minute-granularity,
// user-facing "starting soon") and Analytics' 15min (a continuously-updating
// dashboard) — tight enough to keep midnight-boundary latency reasonable,
// without the reminder poller's needlessly frequent cadence for this use case.
const POLL_INTERVAL_MS = 30 * 60_000;

// Exported pure helpers — directly unit-testable, same "extract the
// deterministic logic out of the class" precedent
// calendar-reminder-processor.service.ts's own resolveReminderSource/
// reminderNotificationType/reminderTitle already established (that file's
// own spec coverage tests only these, never the processor class's private
// methods directly).
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** A user is due for today's digest if they've never received one, or their
 * last one was before today's UTC midnight. Reused identically for both the
 * tenant-level "who's due" scan and the atomic per-user claim, so the two
 * can never silently drift apart. */
export function notYetDigestedTodayWhere(todayStartUtc: Date): Record<string, unknown> {
  return { OR: [{ lastDigestSentAt: null }, { lastDigestSentAt: { lt: todayStartUtc } }] };
}

interface DigestOutcome {
  email: string;
  name: string;
  summary: DigestSummary;
}

/**
 * A disclosed hybrid of this codebase's two existing `@Interval` processor
 * shapes, neither of which fits alone. Like `AnalyticsSnapshotProcessorService`:
 * no outbox table — "is this user due" is always cheaply re-derivable from
 * `User.lastDigestSentAt` + the current time, never a genuinely one-off
 * triggered unit of work like `EmbeddingJob`/`CalendarReminder`. Like
 * `CalendarReminderProcessorService`: real external I/O (email), so it also
 * needs the "claim, then do I/O outside any transaction" discipline —
 * motivated by this project's own documented past incident where a slow
 * Resend call inside a transaction caused a timeout.
 *
 * Per-tenant round robin wrapped in its own try/catch (Analytics' discipline,
 * not the coarser one CalendarReminderProcessorService uses) — for a
 * once-a-day send, one tenant's blip silently blocking every other tenant's
 * users for that whole tick is a worse failure mode than it is for a
 * 60s-granularity reminder.
 */
@Injectable()
export class DigestProcessorService {
  private readonly logger = new Logger(DigestProcessorService.name);
  private running = false;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly emailService: EmailService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processAllTenants();
    } catch (err) {
      this.logger.error("Digest poll failed", err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async processAllTenants() {
    const tenants = await this.tenantPrisma.root.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await this.processTenant(tenant.id);
      } catch (err) {
        this.logger.warn(`Digest processing failed for tenant ${tenant.id}`, err instanceof Error ? err.stack : String(err));
      }
    }
  }

  private async processTenant(tenantId: string) {
    const now = new Date();
    const todayStartUtc = startOfUtcDay(now);

    const dueUsers = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId, deletedAt: null, digestOptOut: false, ...notYetDigestedTodayWhere(todayStartUtc) },
        select: { id: true },
      }),
    );

    for (const { id: userId } of dueUsers) {
      try {
        await this.processUser(tenantId, userId, now, todayStartUtc);
      } catch (err) {
        this.logger.warn(`Digest failed for user ${userId}`, err instanceof Error ? err.stack : String(err));
      }
    }
  }

  private async processUser(tenantId: string, userId: string, now: Date, todayStartUtc: Date) {
    const outcome = await this.tenantPrisma.run(tenantId, async (tx): Promise<DigestOutcome | null> => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId, deletedAt: null } });
      if (!user) return null; // deleted between the select above and now — skip, not an error

      // Built fresh, never cached — the same recipe DataSourcesController
      // builds per real HTTP request, and aiMessage.send/aiToolCall.confirm
      // already reuse outside a real request.
      const effective = await this.permissionResolver.resolveEffectivePermissionsWithTx(tx, tenantId, userId);
      const ctx: DataSourceContext = { tenantId, userId, userDepartmentId: user.departmentId, effective };

      const raw = await gatherDigestData(tx, ctx, now);
      const summary = buildDigestSummary(raw);
      // Never send an empty "you have nothing today" digest — deliberate.
      // lastDigestSentAt is intentionally left untouched so this user is
      // cheaply re-considered on every later tick this same UTC day.
      if (summary.isEmpty) return null;

      // Atomic claim + Notification write, one transaction — closes the
      // TOCTOU gap between "decided to send" and "marked sent" that the
      // `running` guard alone doesn't address. The same atomic-claim idiom
      // aiToolCall.confirm already established for its own double-confirm
      // race (Phase D).
      const claimed = await tx.user.updateMany({
        where: { id: userId, ...notYetDigestedTodayWhere(todayStartUtc) },
        data: { lastDigestSentAt: now },
      });
      if (claimed.count !== 1) return null; // defensive — already claimed

      await tx.notification.create({
        data: {
          tenantId,
          userId,
          type: "digest.daily",
          title: summary.title,
          body: summary.body,
          data: {
            overdueTasks: summary.overdueTasks,
            dueSoonTasks: summary.dueSoonTasks,
            pendingApprovals: summary.pendingApprovals,
            todayEvents: summary.todayEvents,
            weekEvents: summary.weekEvents,
          } as object,
        },
      });

      return { email: user.email, name: user.displayName, summary };
    });

    if (!outcome) return;

    // Outside any transaction — external I/O, the same hard rule
    // CalendarReminderProcessorService already follows. Never throws; a
    // `false` return is logged, not treated as a processing failure — the
    // day is still correctly "used up" even if the email itself never lands.
    const sent = await this.emailService.sendDigestEmail({
      to: outcome.email,
      recipientName: outcome.name,
      overdueTasks: outcome.summary.overdueTasks,
      dueSoonTasks: outcome.summary.dueSoonTasks,
      pendingApprovals: outcome.summary.pendingApprovals,
      todayEvents: outcome.summary.todayEvents,
      weekEvents: outcome.summary.weekEvents,
    });
    if (!sent) this.logger.warn(`Digest email to ${outcome.email} failed`);
  }
}
