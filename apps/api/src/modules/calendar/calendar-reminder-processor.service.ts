import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { EmailService } from "../../email/email.service";
import type { ReminderSourceType } from "./reminder-outbox";

// Reminders are set in minute-granularity increments — 60s resolution is
// more than adequate, and cheaper than embeddings' 15s cadence (tuned for a
// much more latency-sensitive RAG-freshness case).
const POLL_INTERVAL_MS = 60_000;
// A reminder is cheap: one Notification write + one email call, versus
// embeddings' expensive external embedding-API call bounding its batch to 5.
const JOB_BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 32) * 60_000;
}

interface ClaimedReminder {
  id: string;
  sourceType: string;
  sourceId: string;
  recipientUserId: string;
  attempts: number;
}

/** `null` = the source is gone/cancelled/deleted since the reminder was
 * enqueued — the caller treats this as "done," not a failure, same as
 * EmbeddingJobProcessorService's identical "nothing to do" handling. */
export async function resolveReminderSource(
  tx: PrismaTx,
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<{ title: string; startAt: Date } | null> {
  if (sourceType === "meeting") {
    const meeting = await tx.meeting.findFirst({ where: { id: sourceId, tenantId, cancelledAt: null } });
    return meeting ? { title: meeting.title, startAt: meeting.scheduledStart } : null;
  }
  if (sourceType === "calendarEvent") {
    const event = await tx.calendarEvent.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    return event ? { title: event.title, startAt: event.startAt } : null;
  }
  if (sourceType === "task") {
    const task = await tx.task.findFirst({ where: { id: sourceId, tenantId, deletedAt: null } });
    return task && task.dueDate ? { title: task.title, startAt: task.dueDate } : null;
  }
  return null;
}

export function reminderNotificationType(sourceType: ReminderSourceType | string): string {
  if (sourceType === "meeting") return "meeting.reminder";
  if (sourceType === "calendarEvent") return "calendarEvent.reminder";
  return "task.reminder";
}

export function reminderTitle(sourceType: ReminderSourceType | string): string {
  if (sourceType === "meeting") return "Upcoming meeting";
  if (sourceType === "calendarEvent") return "Upcoming calendar event";
  return "Task due soon";
}

/**
 * Mirrors EmbeddingJobProcessorService's claim/release/backoff shape
 * verbatim — the only recurring-background-job precedent in this codebase.
 * Same tx-boundary discipline: external I/O (the email send) never runs
 * inside a `tenantPrisma.run()` transaction — a hard rule here, motivated by
 * a real past incident (a slow Resend call once pushed a transaction past
 * its timeout and orphaned a Supabase Auth user, see
 * tenant-prisma.service.ts's own doc comment).
 */
@Injectable()
export class CalendarReminderProcessorService {
  private readonly logger = new Logger(CalendarReminderProcessorService.name);
  private running = false;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.processAllTenants();
    } catch (err) {
      this.logger.error("Calendar reminder poll failed", err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }

  private async processAllTenants() {
    const tenants = await this.tenantPrisma.root.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      await this.processTenantReminders(tenant.id);
    }
  }

  private async processTenantReminders(tenantId: string) {
    const claimed = await this.tenantPrisma.run(tenantId, async (tx) => {
      const due = await tx.calendarReminder.findMany({
        where: { tenantId, status: "pending", availableAt: { lte: new Date() } },
        orderBy: { createdAt: "asc" },
        take: JOB_BATCH_SIZE,
      });
      if (due.length === 0) return [];
      await tx.calendarReminder.updateMany({ where: { id: { in: due.map((r) => r.id) } }, data: { status: "processing" } });
      return due.map(
        (r): ClaimedReminder => ({ id: r.id, sourceType: r.sourceType, sourceId: r.sourceId, recipientUserId: r.recipientUserId, attempts: r.attempts }),
      );
    });

    for (const reminder of claimed) {
      await this.processReminder(tenantId, reminder);
    }
  }

  private async processReminder(tenantId: string, reminder: ClaimedReminder) {
    try {
      const source = await this.tenantPrisma.run(tenantId, (tx) => resolveReminderSource(tx, tenantId, reminder.sourceType, reminder.sourceId));
      if (!source) {
        await this.markDone(tenantId, reminder.id);
        return;
      }

      const recipient = await this.tenantPrisma.run(tenantId, (tx) =>
        tx.user.findFirst({ where: { id: reminder.recipientUserId, tenantId, deletedAt: null }, select: { email: true, displayName: true } }),
      );
      if (!recipient) {
        await this.markDone(tenantId, reminder.id);
        return;
      }

      await this.tenantPrisma.run(tenantId, (tx) =>
        tx.notification.create({
          data: {
            tenantId,
            userId: reminder.recipientUserId,
            type: reminderNotificationType(reminder.sourceType),
            title: reminderTitle(reminder.sourceType),
            body: source.title,
            data: { sourceType: reminder.sourceType, sourceId: reminder.sourceId },
          },
        }),
      );

      // Outside any transaction — external I/O. Never throws; a `false`
      // return is logged, not treated as job failure (the in-app
      // notification already succeeded, same as sendInviteEmail's
      // "delivery failure must never fail the operation" precedent).
      const sent = await this.emailService.sendReminderEmail({
        to: recipient.email,
        recipientName: recipient.displayName,
        itemTitle: source.title,
        itemType: reminder.sourceType,
        startAt: source.startAt,
      });
      if (!sent) this.logger.warn(`Reminder email to ${recipient.email} failed (reminder ${reminder.id})`);

      await this.markDone(tenantId, reminder.id);
    } catch (err) {
      await this.markFailed(tenantId, reminder.id, reminder.attempts, err);
    }
  }

  private async markDone(tenantId: string, reminderId: string) {
    await this.tenantPrisma.run(tenantId, (tx) => tx.calendarReminder.update({ where: { id: reminderId }, data: { status: "done" } }));
  }

  private async markFailed(tenantId: string, reminderId: string, priorAttempts: number, err: unknown) {
    const attempts = priorAttempts + 1;
    const lastError = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Calendar reminder ${reminderId} failed (attempt ${attempts}): ${lastError}`);

    await this.tenantPrisma.run(tenantId, (tx) =>
      tx.calendarReminder.update({
        where: { id: reminderId },
        data:
          attempts >= MAX_ATTEMPTS
            ? { status: "failed", attempts, lastError }
            : { status: "pending", attempts, lastError, availableAt: new Date(Date.now() + backoffMs(attempts)) },
      }),
    );
  }
}
