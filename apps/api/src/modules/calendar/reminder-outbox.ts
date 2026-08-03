import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

export type ReminderSourceType = "meeting" | "calendarEvent" | "task";

/**
 * Enqueues one `CalendarReminder` row per recipient — one batched
 * `createMany` call, never a sequential loop (same discipline as
 * `announcement.create`'s notification fan-out; the `materializeDepartmentTypeLabels`
 * 47-sequential-upsert transaction-timeout incident, CONTEXT.md, is exactly
 * what this avoids).
 *
 * No-ops when `reminderMinutesBefore` is omitted or `recipientUserIds` is
 * empty. A reminder whose computed `availableAt` has already passed (e.g. a
 * short lead time on an already-imminent meeting) is still enqueued as-is —
 * `CalendarReminderProcessorService`'s next poll picks it up immediately
 * (`availableAt <= now()` already holds), not silently dropped.
 */
export async function enqueueReminders(
  tx: PrismaTx,
  tenantId: string,
  sourceType: ReminderSourceType,
  sourceId: string,
  startAt: Date,
  reminderMinutesBefore: number | undefined,
  recipientUserIds: string[],
): Promise<void> {
  if (!reminderMinutesBefore || recipientUserIds.length === 0) return;

  const availableAt = new Date(startAt.getTime() - reminderMinutesBefore * 60_000);
  await tx.calendarReminder.createMany({
    data: recipientUserIds.map((recipientUserId) => ({
      tenantId,
      sourceType,
      sourceId,
      recipientUserId,
      availableAt,
    })),
  });
}
