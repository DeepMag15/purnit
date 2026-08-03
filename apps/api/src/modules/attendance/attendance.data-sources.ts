import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@antigravity/manifest-schema";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { isRowInScope } from "../../rbac/scope-check";

/**
 * Resolves which OTHER users' attendance the actor's granted `attendance:read`
 * scope covers — mirrors `hr.data-sources.ts`'s `scopedDepartmentIds` shape,
 * but resolves user ids, not department ids, since Attendance has no
 * department-scoped table of its own (see `attendance.mutations.ts`'s own
 * comment on why `AttendanceRecord` carries no `departmentId` column).
 * Returns `null` for `"own"` — the caller then knows this is self-only, no
 * roster. Always includes the actor's own id, even if departmentless.
 */
async function resolveScopedRosterUserIds(tx: PrismaTx, ctx: DataSourceContext, scope: Scope): Promise<string[] | null> {
  if (scope === "own") return null;
  if (scope === "tenant") {
    const users = await tx.user.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, select: { id: true } });
    return users.map((u) => u.id);
  }
  const departmentIds =
    scope === "department-subtree" && ctx.userDepartmentId
      ? await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId)
      : ctx.userDepartmentId
        ? [ctx.userDepartmentId]
        : [];
  if (departmentIds.length === 0) return [ctx.userId];
  const users = await tx.user.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null, departmentId: { in: departmentIds } }, select: { id: true } });
  const ids = new Set(users.map((u) => u.id));
  ids.add(ctx.userId);
  return [...ids];
}

/** Only resolved when actually needed — see department-subtree.ts. Same
 * local-helper precedent as every other module's own `resolveSubtreeIds`. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: DataSourceContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

const ListParamsSchema = z.object({
  userId: z.string().optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

/**
 * Three modes, selected by `params.userId` + the actor's granted scope:
 * (a) no `userId` (or `userId === ctx.userId`) — self history, no scope
 *     check needed.
 * (b) explicit `userId` for someone else — single-target `isRowInScope`
 *     check, the exact `assertInviteesInScope` precedent
 *     (`meetings.mutations.ts:41-59`), applied to one known target instead
 *     of a batch of invite candidates.
 * (c) no `userId`, scope wider than `"own"` — team/department roster mode,
 *     returning `{ roster, records }` for the frontend to join client-side
 *     (same "aggregate minimally server-side" precedent
 *     `CalendarWorkspace.tsx`'s own day-bucketing already sets).
 */
export const attendanceListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "attendance.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "attendance:read",
  async resolve(params, ctx, tx) {
    const { from, to, userId } = params;
    const scope = ctx.effective.has("attendance", "read");
    // requiredPermission already gates presence — a null scope here would
    // mean the permission-pruner's own gate was somehow bypassed, not a
    // real runtime case, but fail closed rather than assume.
    if (!scope) throw new ForbiddenException('Missing permission "attendance:read"');

    if (!userId || userId === ctx.userId) {
      const records = await tx.attendanceRecord.findMany({
        where: { tenantId: ctx.tenantId, userId: ctx.userId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      });
      return { roster: [], records };
    }

    if (scope !== "own") {
      const target = await tx.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId, deletedAt: null }, select: { id: true, departmentId: true } });
      if (!target) throw new NotFoundException(`No user "${userId}"`);
      const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
      const inScope = isRowInScope(
        scope,
        { ownerId: null, departmentId: target.departmentId },
        { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
      );
      if (!inScope) throw new ForbiddenException("Not allowed to view this user's attendance");
      const records = await tx.attendanceRecord.findMany({
        where: { tenantId: ctx.tenantId, userId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      });
      return { roster: [], records };
    }

    throw new ForbiddenException("Not allowed to view this user's attendance");
  },
};

/** Separate entry point for team/department roster mode — no `userId` param
 * at all, always resolves via `resolveScopedRosterUserIds`. Kept as its own
 * data source (rather than folding a fourth branch into `attendance.list`
 * above) so the frontend's intent is unambiguous from the call site: "give
 * me my own history" vs. "give me my team's roster for a date," never
 * inferred from the absence of a param. */
const RosterParamsSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() });

export const attendanceRosterDataSource: DataSourceDefinition<z.infer<typeof RosterParamsSchema>> = {
  name: "attendance.roster",
  paramsSchema: RosterParamsSchema,
  requiredPermission: "attendance:read",
  async resolve(params, ctx, tx) {
    const { from, to } = params;
    const scope = ctx.effective.has("attendance", "read");
    if (!scope) throw new ForbiddenException('Missing permission "attendance:read"');

    const userIds = await resolveScopedRosterUserIds(tx, ctx, scope);
    if (userIds === null) return { roster: [], records: [] }; // "own" scope has no team to roster

    const roster = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, departmentId: true } });
    const records = await tx.attendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, userId: { in: userIds }, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
    return { roster, records };
  },
};
