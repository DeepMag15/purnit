import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@antigravity/manifest-schema";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { enqueueReminders } from "./reminder-outbox";

/** Only resolved when actually needed — see department-subtree.ts. Same
 * local-helper precedent as announcements.mutations.ts's own resolveSubtreeIds
 * (deliberately duplicated per module, not shared, per this codebase's
 * established convention). */
async function resolveSubtreeIds(tx: PrismaTx, ctx: MutationContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

/** Resolves every recipient for a broadcast target: the target department's
 * full subtree, or everyone in the tenant for a tenant-wide post — exact
 * mirror of announcements.mutations.ts's own resolveAudienceUserIds. */
async function resolveAudienceUserIds(tx: PrismaTx, tenantId: string, departmentId: string | null): Promise<string[]> {
  const where = departmentId
    ? { tenantId, deletedAt: null, departmentId: { in: await getDepartmentSubtreeIds(tx, tenantId, departmentId) } }
    : { tenantId, deletedAt: null };
  const rows = await tx.user.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}

const CreateInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    // Omitted departmentId + no broadcastTenantWide = personal (own scope,
    // always available — see seed.ts's role.intern). Either one set = a
    // broadcast, requiring a real calendarEvent:create:<scope> grant.
    departmentId: z.string().optional(),
    broadcastTenantWide: z.boolean().optional(),
    reminderMinutesBefore: z.number().int().positive().max(10_080).optional(),
  })
  .refine((data) => !data.endAt || data.endAt > data.startAt, { message: "endAt must be after startAt", path: ["endAt"] })
  .refine((data) => !(data.departmentId && data.broadcastTenantWide), {
    message: "departmentId and broadcastTenantWide are mutually exclusive",
    path: ["departmentId"],
  });

export const calendarEventCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "calendarEvent.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "calendarEvent:create",
  async resolve(input, ctx, tx) {
    const isBroadcast = !!input.departmentId || !!input.broadcastTenantWide;
    let targetDepartmentId: string | null = null;

    if (isBroadcast) {
      const scope = ctx.effective.has("calendarEvent", "create");
      if (!scope) throw new ForbiddenException('Missing permission "calendarEvent:create"');

      targetDepartmentId = input.departmentId ?? null;
      const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
      const inScope = isRowInScope(
        scope,
        { ownerId: null, departmentId: targetDepartmentId },
        { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
      );
      if (!inScope) throw new ForbiddenException("Not allowed to post a calendar event to this target");
    }
    // Personal path: no extra check — calendarEvent:create:own is a
    // universal baseline (seed.ts's role.intern), so every actor with the
    // presence-only requiredPermission gate above already qualifies.

    const event = await tx.calendarEvent.create({
      data: {
        tenantId: ctx.tenantId,
        authorId: ctx.userId,
        isPrivate: !isBroadcast,
        departmentId: targetDepartmentId,
        title: input.title,
        description: input.description,
        startAt: input.startAt,
        endAt: input.endAt,
      },
    });

    // Personal events remind only the author; broadcasts remind (and
    // notify) the resolved audience minus the author. A broadcaster
    // deliberately does not get an automatic self-reminder for their own
    // broadcast — low-stakes simplification, same excludes-self list the
    // notification fan-out already uses.
    const recipients = isBroadcast ? (await resolveAudienceUserIds(tx, ctx.tenantId, targetDepartmentId)).filter((id) => id !== ctx.userId) : [ctx.userId];

    if (isBroadcast && recipients.length > 0) {
      // One batched multi-row insert, not a sequential loop — same
      // discipline as announcement.create (materializeDepartmentTypeLabels'
      // 47-row transaction-timeout incident, CONTEXT.md, is exactly what
      // this avoids).
      await tx.notification.createMany({
        data: recipients.map((userId) => ({
          tenantId: ctx.tenantId,
          userId,
          type: "calendarEvent.posted",
          title: "New calendar event",
          body: event.title,
          data: { calendarEventId: event.id },
        })),
      });
    }

    await enqueueReminders(tx, ctx.tenantId, "calendarEvent", event.id, event.startAt, input.reminderMinutesBefore, recipients);

    return event;
  },
};

const DeleteInputSchema = z.object({ id: z.string() });

// No requiredPermission — ownership-only, exact mirror of
// announcement.delete. Pending CalendarReminder rows for a deleted event are
// not eagerly cleaned up here — the poller's graceful skip-if-gone handling
// (calendar-reminder-processor.service.ts) covers it at fire time.
export const calendarEventDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "calendarEvent.delete",
  inputSchema: DeleteInputSchema,
  async resolve(input, ctx, tx) {
    const existing = await tx.calendarEvent.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No calendar event "${input.id}"`);
    if (existing.authorId !== ctx.userId) throw new ForbiddenException("You can only delete your own calendar events");

    return tx.calendarEvent.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
  },
};
