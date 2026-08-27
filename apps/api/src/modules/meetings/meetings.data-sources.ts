import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";

/**
 * Meeting visibility is participant-floor-always-on, confirmed with the user
 * during planning: every tenant member — even one with zero `meeting:read`
 * grant (e.g. an Intern) — always sees a meeting they organize or were
 * personally added to, the same way a calendar invite works regardless of
 * your standing in an org chart. `meeting:read:<scope>` only *widens*
 * visibility further (e.g. a Manager also seeing their department's
 * meetings they weren't personally invited to). This deliberately diverges
 * from `projectsWhere`'s stricter "zero grant -> zero visibility" shape —
 * meeting participation is closer to a personal invite than project
 * authority. Never returns `null`, unlike `projectsWhere`/`tasksWhere`.
 */
export async function meetingsWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const floor: Record<string, unknown>[] = [{ organizerId: ctx.userId }, { participants: { some: { userId: ctx.userId } } }];

  const scope = ctx.effective.has("meeting", "read");
  if (!scope || scope === "own") {
    return { tenantId: ctx.tenantId, ...extra, OR: floor };
  }
  if (scope === "tenant") {
    return { tenantId: ctx.tenantId, ...extra };
  }

  const conditions = [...floor];
  if (scope === "department-subtree") {
    if (ctx.userDepartmentId) {
      const subtreeIds = await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId);
      conditions.push({ departmentId: { in: subtreeIds } });
    }
  } else if (ctx.userDepartmentId) {
    // department / team — no teamId column on Meeting yet, same
    // "team approximates to department" precedent as Project/Task.
    conditions.push({ departmentId: ctx.userDepartmentId });
  }
  return { tenantId: ctx.tenantId, ...extra, OR: conditions };
}

async function withOrganizerNames(tx: PrismaTx, meetings: { organizerId: string }[]) {
  const organizerIds = [...new Set(meetings.map((m) => m.organizerId))];
  if (organizerIds.length === 0) return new Map<string, string>();
  const organizers = await tx.user.findMany({ where: { id: { in: organizerIds } }, select: { id: true, displayName: true } });
  return new Map(organizers.map((o) => [o.id, o.displayName]));
}

/** Mirrors `projects.data-sources.ts`'s `withMembers` — one query for the
 * join rows, one for the distinct users, merged into a per-meeting list. */
async function withParticipants(tx: PrismaTx, meetings: { id: string }[]) {
  const meetingIds = meetings.map((m) => m.id);
  if (meetingIds.length === 0) return new Map<string, { id: string; displayName: string }[]>();

  const memberships = await tx.meetingParticipant.findMany({ where: { meetingId: { in: meetingIds } } });
  const userIds = [...new Set(memberships.map((m) => m.userId))];
  const users = userIds.length > 0 ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const byMeeting = new Map<string, { id: string; displayName: string }[]>();
  for (const m of memberships) {
    const user = userById.get(m.userId);
    if (!user) continue;
    const list = byMeeting.get(m.meetingId) ?? [];
    list.push(user);
    byMeeting.set(m.meetingId, list);
  }
  return byMeeting;
}

const ListParamsSchema = z.object({});

// No requiredPermission — see meetingsWhere's doc comment. Every tenant
// member can call this; what they get back is scope-filtered, not gated.
export const meetingsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "meetings.list",
  paramsSchema: ListParamsSchema,
  async resolve(_params, ctx, tx) {
    // Upcoming/Past/Cancelled are split client-side (MeetingsWorkspace) off
    // `scheduledEnd`/`cancelledAt` — one query, one scope resolution, same
    // "capped result set, no real pagination yet" precedent as
    // `projects.list`. Revisit once a tenant has enough meetings to need it.
    const where = await meetingsWhere(tx, ctx, {});
    const meetings = await tx.meeting.findMany({ where, orderBy: { scheduledStart: "desc" }, take: 100 });

    const organizerNames = await withOrganizerNames(tx, meetings);
    const participantsByMeeting = await withParticipants(tx, meetings);

    return meetings.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      scheduledStart: m.scheduledStart,
      scheduledEnd: m.scheduledEnd,
      organizerId: m.organizerId,
      organizerName: organizerNames.get(m.organizerId) ?? null,
      departmentId: m.departmentId,
      cancelledAt: m.cancelledAt,
      videoRoomName: m.videoRoomName,
      participants: participantsByMeeting.get(m.id) ?? [],
      isOrganizer: m.organizerId === ctx.userId,
      isParticipant: (participantsByMeeting.get(m.id) ?? []).some((p) => p.id === ctx.userId),
    }));
  },
};

const InviteCandidatesParamsSchema = z.object({});

/**
 * Fixes a real gap found while implementing the frontend: `users.list` is
 * gated on `user:manage`, which Lead/Manager tiers (who DO hold
 * `meeting:create`, per seed.ts's role ladder) never get — reusing
 * `users.list` for the participant picker would leave the very tiers this
 * feature targets unable to invite anyone through the UI, even though the
 * backend would happily authorize it. Gated on `meeting:create` instead —
 * the exact permission a caller needs to be scheduling a meeting at all, so
 * this never widens who can enumerate the roster beyond who could already
 * invite people to something. No new permission triple.
 */
export const meetingsInviteCandidatesDataSource: DataSourceDefinition<z.infer<typeof InviteCandidatesParamsSchema>> = {
  name: "meetings.inviteCandidates",
  paramsSchema: InviteCandidatesParamsSchema,
  requiredPermission: "meeting:create",
  async resolve(_params, ctx, tx) {
    const users = await tx.user.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    return users;
  },
};

const CapabilitiesParamsSchema = z.object({});

/**
 * Frontend Redesign, Phase 02 — `MeetingsWorkspace.tsx` moved off the SDUI
 * Renderer onto a dedicated route, so it no longer gets a permission-pruned
 * `actions` array to derive `canSchedule` from. Same `project.detail`-style
 * capability-flag precedent as `calendar.capabilities`'s own doc comment —
 * no `requiredPermission` (callable by anyone). Pure parity here, not a
 * bug fix: `canSchedule` was already correctly `actions`-derived before.
 */
export const meetingsCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof CapabilitiesParamsSchema>> = {
  name: "meetings.capabilities",
  paramsSchema: CapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return { canSchedule: !!ctx.effective.has("meeting", "create") };
  },
};
