import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@antigravity/manifest-schema";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { JitsiService } from "../../integrations/jitsi.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { enqueueReminders } from "../calendar/reminder-outbox";

/** Confirms a meeting exists (tenant-scoped, not cancelled) and the actor is
 * one of its participants — exact mirror of `assertConversationMember`:
 * membership is the whole gate for "can I join/see the details of this
 * specific meeting," no RBAC question beyond it. */
export async function assertMeetingParticipant(tx: PrismaTx, ctx: DataSourceContext, meetingId: string) {
  const meeting = await tx.meeting.findFirst({ where: { id: meetingId, tenantId: ctx.tenantId, cancelledAt: null } });
  if (!meeting) throw new NotFoundException(`No meeting "${meetingId}"`);

  const membership = await tx.meetingParticipant.findFirst({ where: { meetingId, userId: ctx.userId } });
  if (!membership) throw new ForbiddenException("You are not a participant in this meeting");

  return meeting;
}

/** Only resolved when actually needed — see department-subtree.ts. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: MutationContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

/** Drops ids that don't resolve to a real, non-deleted tenant user — same
 * graceful-drop precedent as `filterValidTenantUserIds`/`resolveValidMentions`
 * — and returns each survivor's `departmentId`, needed by the invite-breadth
 * check below. */
async function resolveCandidateParticipants(tx: PrismaTx, tenantId: string, ids: string[]): Promise<{ id: string; departmentId: string | null }[]> {
  if (ids.length === 0) return [];
  return tx.user.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true, departmentId: true } });
}

/** "How broadly can the organizer invite" — reuses `isRowInScope` unmodified
 * (no new scope logic), treating each candidate's own `departmentId` as the
 * row being checked. A candidate with no `ownerId`-shaped concept of their
 * own (a User isn't "owned"), so this collapses to a department/subtree
 * match, same as `project:create`'s existing use of the same helper for "can
 * I create within this department." Throws on the first violator. */
async function assertInviteesInScope(
  tx: PrismaTx,
  ctx: MutationContext,
  scope: Scope,
  candidates: { id: string; departmentId: string | null }[],
): Promise<void> {
  const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
  for (const candidate of candidates) {
    if (!isRowInScope(scope, { ownerId: null, departmentId: candidate.departmentId }, { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds })) {
      throw new ForbiddenException(`Not allowed to invite this participant to a meeting`);
    }
  }
}

/** Notifies every invitee except the organizer — same
 * `notificationRecipientFor`-style self-exclusion convention as
 * `tasks.mutations.ts` (you don't need to be told about your own action). */
async function notifyInvitees(tx: PrismaTx, tenantId: string, meetingId: string, title: string, organizerId: string, inviteeIds: string[]): Promise<void> {
  for (const userId of inviteeIds) {
    if (userId === organizerId) continue;
    await tx.notification.create({
      data: {
        tenantId,
        userId,
        type: "meeting.invited",
        title: "You've been invited to a meeting",
        body: title,
        data: { meetingId },
      },
    });
  }
}

const CreateInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  departmentId: z.string().optional(),
  participantIds: z.array(z.string()).optional(),
  // Calendar & Scheduling (Core Workspace Phase 3) — optional, enqueues one
  // CalendarReminder row per participant via enqueueReminders below.
  reminderMinutesBefore: z.number().int().positive().max(10_080).optional(),
}).refine((data) => data.scheduledEnd > data.scheduledStart, { message: "scheduledEnd must be after scheduledStart", path: ["scheduledEnd"] });

/** A plain constant again, not a factory — unlike Daily, self-hosted Jitsi
 * has no "create the room via a REST call" step (a room exists implicitly
 * the moment someone joins it), so there's no external I/O to run via
 * `preResolve`/`rollbackPreResolve` here anymore. Those framework hooks
 * (added for Daily) stay in mutation-registry.service.ts/mutations.controller.ts
 * untouched — general-purpose infrastructure for whatever mutation needs
 * "external I/O before the transaction" next, not Daily-specific. */
export const meetingCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "meeting.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "meeting:create",
  async resolve(input, ctx, tx) {
    const scope = ctx.effective.has("meeting", "create");
    if (!scope) throw new ForbiddenException("Missing permission \"meeting:create\"");

    const candidateIds = (input.participantIds ?? []).filter((id) => id !== ctx.userId);
    const candidates = await resolveCandidateParticipants(tx, ctx.tenantId, candidateIds);
    await assertInviteesInScope(tx, ctx, scope, candidates);

    const roomName = `mtg-${randomUUID()}`;
    const meeting = await tx.meeting.create({
      data: {
        tenantId: ctx.tenantId,
        title: input.title,
        description: input.description,
        organizerId: ctx.userId,
        departmentId: input.departmentId ?? ctx.userDepartmentId ?? null,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        videoRoomName: roomName,
      },
    });

    const participantIds = [ctx.userId, ...candidates.map((c) => c.id)];
    // Sequential — concurrent queries against one shared transactional `tx`
    // are unsafe (see CONTEXT.md §9).
    for (const userId of participantIds) {
      await tx.meetingParticipant.create({ data: { tenantId: ctx.tenantId, meetingId: meeting.id, userId } });
    }
    await notifyInvitees(tx, ctx.tenantId, meeting.id, meeting.title, ctx.userId, participantIds);
    await enqueueReminders(tx, ctx.tenantId, "meeting", meeting.id, meeting.scheduledStart, input.reminderMinutesBefore, participantIds);

    return meeting;
  },
};

const CancelInputSchema = z.object({ id: z.string() });

/** Plain constant, not a factory — no service dependency at all now. Not
 * gated by `requiredPermission` — organizer-only ownership gate, same
 * precedent as `conversation.archive`. Cancelling your own meeting isn't a
 * department-breadth question, so no `isRowInScope` check here. Unlike
 * Daily, there's no persistent per-room resource to delete via an API call
 * on cancel — Jitsi has nothing to clean up server-side. */
export const meetingCancelMutation: MutationDefinition<z.infer<typeof CancelInputSchema>> = {
  name: "meeting.cancel",
  inputSchema: CancelInputSchema,
  async resolve(input, ctx, tx) {
    const meeting = await tx.meeting.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, cancelledAt: null } });
    if (!meeting) throw new NotFoundException(`No meeting "${input.id}"`);
    if (meeting.organizerId !== ctx.userId) throw new ForbiddenException("Only the organizer can cancel this meeting");

    return tx.meeting.update({ where: { id: input.id }, data: { cancelledAt: new Date() } });
  },
};

const ParticipantInputSchema = z.object({ meetingId: z.string(), userId: z.string() });

/** Fetches the meeting and confirms the caller is its organizer, then
 * re-runs the same invite-breadth check `meeting.create` used — shared by
 * both participant mutations below rather than duplicated inline. */
async function requireOrganizerAndInviteScope(tx: PrismaTx, ctx: MutationContext, meetingId: string, candidateUserId: string) {
  const meeting = await tx.meeting.findFirst({ where: { id: meetingId, tenantId: ctx.tenantId, cancelledAt: null } });
  if (!meeting) throw new NotFoundException(`No meeting "${meetingId}"`);
  if (meeting.organizerId !== ctx.userId) throw new ForbiddenException("Only the organizer can manage this meeting's participants");

  const scope = ctx.effective.has("meeting", "create");
  if (!scope) throw new ForbiddenException("Missing permission \"meeting:create\"");
  const candidates = await resolveCandidateParticipants(tx, ctx.tenantId, [candidateUserId]);
  await assertInviteesInScope(tx, ctx, scope, candidates);

  return meeting;
}

export const meetingAddParticipantMutation: MutationDefinition<z.infer<typeof ParticipantInputSchema>> = {
  name: "meeting.addParticipant",
  inputSchema: ParticipantInputSchema,
  async resolve(input, ctx, tx) {
    const meeting = await requireOrganizerAndInviteScope(tx, ctx, input.meetingId, input.userId);

    // Idempotent — adding an existing participant is a no-op, not an error,
    // same precedent as project.addMember.
    const existing = await tx.meetingParticipant.findFirst({ where: { meetingId: input.meetingId, userId: input.userId } });
    if (!existing) {
      await tx.meetingParticipant.create({ data: { tenantId: ctx.tenantId, meetingId: input.meetingId, userId: input.userId } });
      await notifyInvitees(tx, ctx.tenantId, meeting.id, meeting.title, ctx.userId, [input.userId]);
    }
    return { success: true };
  },
};

export const meetingRemoveParticipantMutation: MutationDefinition<z.infer<typeof ParticipantInputSchema>> = {
  name: "meeting.removeParticipant",
  inputSchema: ParticipantInputSchema,
  async resolve(input, ctx, tx) {
    const meeting = await tx.meeting.findFirst({ where: { id: input.meetingId, tenantId: ctx.tenantId, cancelledAt: null } });
    if (!meeting) throw new NotFoundException(`No meeting "${input.meetingId}"`);
    if (meeting.organizerId !== ctx.userId) throw new ForbiddenException("Only the organizer can manage this meeting's participants");
    if (input.userId === meeting.organizerId) throw new BadRequestException("Cannot remove the organizer from their own meeting");

    await tx.meetingParticipant.deleteMany({ where: { meetingId: input.meetingId, userId: input.userId } });
    return { success: true };
  },
};

const GetJoinInfoInputSchema = z.object({ meetingId: z.string() });

/** A factory (needs `JitsiService`), gated entirely by `assertMeetingParticipant`
 * — no `requiredPermission`, same membership-only shape as everything else
 * that answers "can I join this specific thing." No `preResolve` needed:
 * signing a JWT is a fast, in-process operation with nothing external to
 * roll back — even more true here than it was for `tenant.createLogoUploadUrl`,
 * which at least made a real HTTP call. */
export function createMeetingGetJoinInfoMutation(jitsi: JitsiService): MutationDefinition<z.infer<typeof GetJoinInfoInputSchema>> {
  return {
    name: "meeting.getJoinInfo",
    inputSchema: GetJoinInfoInputSchema,
    async resolve(input, ctx, tx) {
      const meeting = await assertMeetingParticipant(tx, ctx, input.meetingId);

      const user = await tx.user.findFirst({ where: { id: ctx.userId, tenantId: ctx.tenantId } });
      const userName = user?.displayName ?? "Guest";
      const isOwner = meeting.organizerId === ctx.userId;
      // 2h token lifetime — long enough for one call, short enough that a
      // leaked token isn't a standing access grant.
      const exp = Math.floor(Date.now() / 1000) + 2 * 3600;
      const token = await jitsi.createJoinToken(meeting.videoRoomName, { id: ctx.userId, name: userName, email: user?.email }, { isModerator: isOwner, exp });

      return { roomName: meeting.videoRoomName, token, isOwner };
    },
  };
}
