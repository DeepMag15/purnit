import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@purnit/manifest-schema";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Only resolved when actually needed — see department-subtree.ts. Same
 * local-helper precedent as every other module's own `resolveSubtreeIds`. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: MutationContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

const STATUSES = ["present", "absent", "late", "half_day"] as const;

const MarkInputSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().max(500).optional(),
});

/**
 * Self-marking only — `date`/`userId` are never accepted as input, both are
 * always forced server-side (today, `ctx.userId`), which is what makes "no
 * backdating by the employee" a real guarantee, not just a UI convention.
 * No row-scope check at all — `attendance:create` never widens past `:own`
 * for anyone (see seed.ts's role.intern), so the presence-only
 * `requiredPermission` gate is already sufficient, same as
 * `calendarEvent.create`'s personal path.
 */
export const attendanceMarkMutation: MutationDefinition<z.infer<typeof MarkInputSchema>> = {
  name: "attendance.mark",
  inputSchema: MarkInputSchema,
  requiredPermission: "attendance:create",
  async resolve(input, ctx, tx) {
    const today = startOfUtcDay(new Date());
    return tx.attendanceRecord.upsert({
      where: { tenantId_userId_date: { tenantId: ctx.tenantId, userId: ctx.userId, date: today } },
      create: { tenantId: ctx.tenantId, userId: ctx.userId, date: today, status: input.status, note: input.note, markedById: ctx.userId },
      update: { status: input.status, note: input.note, markedById: ctx.userId },
    });
  },
};

const CorrectInputSchema = z
  .object({
    userId: z.string(),
    date: z.coerce.date(),
    status: z.enum(STATUSES),
    note: z.string().max(500).optional(),
  })
  .refine((data) => startOfUtcDay(data.date) <= startOfUtcDay(new Date()), { message: "date cannot be in the future", path: ["date"] });

/**
 * A Department Head+ correcting a report's record (or their own past miss —
 * `input.userId === ctx.userId` skips the department-lookup entirely).
 *
 * ⚠️ `attendance:update` never grants `"own"` scope in seed.ts, deliberately
 * — not an oversight. The subject here is a *different* User row, which has
 * no `ownerId`-shaped concept of its own (same reasoning as
 * `assertInviteesInScope`, meetings.mutations.ts:41-59: "a candidate with no
 * ownerId... collapses to a department/subtree match"). Plugged into
 * `isRowInScope` with `ownerId: null`, the `"own"` branch
 * (`subject.ownerId === actor.userId`) can never be true — an
 * `attendance:update:own` grant would be a silent no-op. Self-correction is
 * therefore special-cased *before* this check ever runs, exactly like
 * `meeting.create` filters `ctx.userId` out of candidates before calling
 * `assertInviteesInScope`.
 */
export const attendanceCorrectMutation: MutationDefinition<z.infer<typeof CorrectInputSchema>> = {
  name: "attendance.correct",
  inputSchema: CorrectInputSchema,
  requiredPermission: "attendance:update",
  async resolve(input, ctx, tx) {
    const scope = ctx.effective.has("attendance", "update");
    if (!scope) throw new ForbiddenException('Missing permission "attendance:update"');

    const date = startOfUtcDay(input.date);

    if (input.userId !== ctx.userId) {
      const target = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null }, select: { id: true, departmentId: true } });
      if (!target) throw new NotFoundException(`No user "${input.userId}"`);

      const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
      const inScope = isRowInScope(
        scope,
        { ownerId: null, departmentId: target.departmentId },
        { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
      );
      if (!inScope) throw new ForbiddenException("Not allowed to correct this user's attendance");
    }

    const record = await tx.attendanceRecord.upsert({
      where: { tenantId_userId_date: { tenantId: ctx.tenantId, userId: input.userId, date } },
      create: { tenantId: ctx.tenantId, userId: input.userId, date, status: input.status, note: input.note, markedById: ctx.userId },
      update: { status: input.status, note: input.note, markedById: ctx.userId },
    });

    // Own-record correction (Department Head fixing their own past miss)
    // isn't notification-worthy — same "telling someone about their own
    // action isn't a notification" precedent as notificationRecipientFor.
    if (input.userId !== ctx.userId) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: input.userId,
          type: "attendance.corrected",
          title: "Your attendance was updated",
          body: `${input.status} on ${date.toISOString().slice(0, 10)}`,
          data: { attendanceRecordId: record.id, date: date.toISOString(), status: input.status },
        },
      });
    }

    return record;
  },
};
