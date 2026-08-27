import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { resolveValidMentions } from "../comments/comments.mutations";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";
import { canReachUser } from "../collaboration/collaboration-reach";

export const CONVERSATION_TYPES = ["channel", "dm"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

/**
 * Confirms a conversation exists (tenant-scoped, not archived) and the actor
 * is one of its members — the entire scope model for chat: membership is
 * the permission, there's no RBAC question to answer beyond it. Same
 * two-step existence-then-scope shape as `assertCommentTargetInScope`.
 */
export async function assertConversationMember(tx: PrismaTx, ctx: DataSourceContext, conversationId: string) {
  const conversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId: ctx.tenantId, archivedAt: null } });
  if (!conversation) throw new NotFoundException(`No conversation "${conversationId}"`);

  const membership = await tx.conversationMember.findFirst({ where: { conversationId, userId: ctx.userId } });
  if (!membership) throw new ForbiddenException("You are not a member of this conversation");

  return conversation;
}

async function getConversationMemberIds(tx: PrismaTx, conversationId: string): Promise<string[]> {
  const members = await tx.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  return members.map((m) => m.userId);
}

/** Drops ids that don't resolve to a real, non-deleted user in this tenant —
 * same graceful-drop precedent as `resolveValidMentions`/`withOwnerNames`
 * rather than hard-erroring on a bad id in an optional bulk list. */
async function filterValidTenantUserIds(tx: PrismaTx, tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const users = await tx.user.findMany({ where: { id: { in: ids }, tenantId, deletedAt: null }, select: { id: true } });
  return users.map((u) => u.id);
}

const CreateChannelInputSchema = z.object({
  name: z.string().min(1).max(80),
  isPrivate: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(),
});

// No requiredPermission — any tenant member may start a channel, same
// "anyone can start a discussion" spirit as comment.create.
export const conversationCreateChannelMutation: MutationDefinition<z.infer<typeof CreateChannelInputSchema>> = {
  name: "conversation.createChannel",
  inputSchema: CreateChannelInputSchema,
  async resolve(input, ctx, tx) {
    const conversation = await tx.conversation.create({
      data: {
        tenantId: ctx.tenantId,
        type: "channel",
        name: input.name,
        isPrivate: input.isPrivate ?? false,
        createdById: ctx.userId,
      },
    });

    const extraMemberIds = await filterValidTenantUserIds(tx, ctx.tenantId, (input.memberIds ?? []).filter((id) => id !== ctx.userId));
    const memberIds = [ctx.userId, ...extraMemberIds];
    // Sequential — concurrent queries against one shared transactional `tx`
    // are unsafe (see CONTEXT.md §9).
    for (const userId of memberIds) {
      await tx.conversationMember.create({ data: { tenantId: ctx.tenantId, conversationId: conversation.id, userId } });
    }

    return conversation;
  },
};

const CreateDmInputSchema = z.object({ otherUserId: z.string() });

/**
 * ⚠️ This used to say "any tenant member may DM any other tenant member", and
 * that is exactly what it did.
 *
 * Verified live in an Education workspace: a **Student** could open a direct
 * message with a teacher who does not teach them (201), with **another
 * student** (201), and with the School Administrator (201). The platform was
 * careful about letting that same student *enumerate* people — `users.list`
 * correctly refuses them 403 — and careless about letting them *contact*
 * anyone they could name.
 *
 * The rule now enforced, as the user specified it: **a student may
 * communicate only with the teachers and staff actually connected to their
 * course, assignment, enrolment or review workflow — never freely with every
 * student or staff member.** Connection is resolved from real rows in
 * `collaboration-reach.ts`, never from a role label, and it is symmetric:
 * staff cannot open a channel to an unconnected learner either. Staff-to-staff
 * DMs are unchanged — nobody asked for an org-wide address-book lockdown.
 *
 * Still no `requiredPermission`, and still a declared ownership-scoped
 * exception: no permission triple can express "is connected to this
 * learner's coursework". The relationship check below IS the authorization.
 */
export const conversationCreateDmMutation: MutationDefinition<z.infer<typeof CreateDmInputSchema>> = {
  name: "conversation.createDm",
  inputSchema: CreateDmInputSchema,
  async resolve(input, ctx, tx) {
    if (input.otherUserId === ctx.userId) throw new BadRequestException("Cannot start a DM with yourself");

    const otherUser = await tx.user.findFirst({ where: { id: input.otherUserId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!otherUser) throw new NotFoundException(`No user "${input.otherUserId}"`);

    // 404 rather than 403 — the same one-answer-for-both-cases rule the rest
    // of the codebase uses (ARCHITECTURE.md §15.1, rule 2). A student probing
    // ids must not be able to tell "this person exists but is off-limits"
    // from "no such person".
    if (!(await canReachUser(tx, ctx.tenantId, ctx.userId, input.otherUserId))) {
      throw new NotFoundException(`No user "${input.otherUserId}"`);
    }

    // Idempotent lookup: v1 DMs are always exactly 2 members, so the first
    // "dm" conversation the caller belongs to whose *other* member is
    // otherUserId is the existing one, if any.
    const candidates = await tx.conversation.findMany({
      where: { tenantId: ctx.tenantId, type: "dm", members: { some: { userId: ctx.userId } } },
      include: { members: { select: { userId: true } } },
    });
    const existing = candidates.find((c) => c.members.length === 2 && c.members.some((m) => m.userId === input.otherUserId));
    if (existing) return existing;

    const conversation = await tx.conversation.create({
      data: { tenantId: ctx.tenantId, type: "dm", isPrivate: true, createdById: ctx.userId },
    });
    await tx.conversationMember.create({ data: { tenantId: ctx.tenantId, conversationId: conversation.id, userId: ctx.userId } });
    await tx.conversationMember.create({ data: { tenantId: ctx.tenantId, conversationId: conversation.id, userId: input.otherUserId } });

    return conversation;
  },
};

const AddMemberInputSchema = z.object({ conversationId: z.string(), userId: z.string() });

export const conversationAddMemberMutation: MutationDefinition<z.infer<typeof AddMemberInputSchema>> = {
  name: "conversation.addMember",
  inputSchema: AddMemberInputSchema,
  // No requiredPermission. Two distinct cases, deliberately handled by one
  // mutation rather than a separate "conversation.join": adding *someone
  // else* requires the caller to already be a member (private-channel
  // invite semantics); a user adding *themselves* is a self-join, allowed
  // only when the channel isn't private — this is what makes `channels.list`
  // (browsable public channels the caller hasn't joined) actually usable.
  async resolve(input, ctx, tx) {
    const conversation = await tx.conversation.findFirst({ where: { id: input.conversationId, tenantId: ctx.tenantId, archivedAt: null } });
    if (!conversation) throw new NotFoundException(`No conversation "${input.conversationId}"`);
    if (conversation.type !== "channel") throw new BadRequestException("Cannot add members to a direct message");

    const isSelfJoin = input.userId === ctx.userId;
    if (isSelfJoin) {
      if (conversation.isPrivate) throw new ForbiddenException("This channel is private — ask a member to add you");
    } else {
      const callerMembership = await tx.conversationMember.findFirst({ where: { conversationId: input.conversationId, userId: ctx.userId } });
      if (!callerMembership) throw new ForbiddenException("You are not a member of this conversation");
    }

    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    // Raw `INSERT ... ON CONFLICT DO NOTHING`, not Prisma's `upsert`: a
    // genuine race is possible here (e.g. a double-click self-join), and
    // both a caught unique-constraint error AND Prisma 7's client-level
    // `upsert` (confirmed live, via two truly concurrent requests during
    // this submodule's own verification, to still throw P2002 under real
    // concurrency rather than compiling to an atomic single statement) leave
    // the transaction unusable for a followup query once one statement
    // errors — Postgres aborts the whole transaction the instant that
    // happens. `ON CONFLICT DO NOTHING` is the one path that's genuinely a
    // single atomic statement and never errors on conflict, so a follow-up
    // `findFirst` in the same transaction (only reached when nothing was
    // inserted) is safe.
    const inserted = await tx.$queryRaw<{ id: string; conversationId: string; userId: string; lastReadAt: Date | null; createdAt: Date }[]>`
      INSERT INTO conversation_members (tenant_id, conversation_id, user_id)
      VALUES (${ctx.tenantId}::uuid, ${input.conversationId}::uuid, ${input.userId}::uuid)
      ON CONFLICT (conversation_id, user_id) DO NOTHING
      RETURNING id, conversation_id AS "conversationId", user_id AS "userId", last_read_at AS "lastReadAt", created_at AS "createdAt"
    `;
    if (inserted.length > 0) return inserted[0];

    return tx.conversationMember.findFirst({ where: { conversationId: input.conversationId, userId: input.userId } });
  },
};

const ArchiveInputSchema = z.object({ conversationId: z.string() });

export const conversationArchiveMutation: MutationDefinition<z.infer<typeof ArchiveInputSchema>> = {
  name: "conversation.archive",
  inputSchema: ArchiveInputSchema,
  // No requiredPermission — creator-only, same ownership-gate precedent as
  // comment.delete.
  async resolve(input, ctx, tx) {
    const conversation = await tx.conversation.findFirst({ where: { id: input.conversationId, tenantId: ctx.tenantId, archivedAt: null } });
    if (!conversation) throw new NotFoundException(`No conversation "${input.conversationId}"`);
    if (conversation.createdById !== ctx.userId) throw new ForbiddenException("Only the creator can archive this conversation");

    return tx.conversation.update({ where: { id: input.conversationId }, data: { archivedAt: new Date() } });
  },
};

const SendInputSchema = z.object({
  conversationId: z.string(),
  body: z.string().min(1).max(4000),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const messageSendMutation: MutationDefinition<z.infer<typeof SendInputSchema>> = {
  name: "message.send",
  inputSchema: SendInputSchema,
  async resolve(input, ctx, tx) {
    await assertConversationMember(tx, ctx, input.conversationId);

    const message = await tx.message.create({
      data: { tenantId: ctx.tenantId, conversationId: input.conversationId, authorId: ctx.userId, body: input.body },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "message", message.id); // AI RAG Phase C

    const memberIds = await getConversationMemberIds(tx, input.conversationId);
    const validMentions = resolveValidMentions(input.mentionedUserIds ?? [], memberIds, ctx.userId);

    // Sequential — same shared-tx safety rule as every other multi-query
    // resolver in this codebase.
    for (const userId of validMentions) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId,
          type: "message.mention",
          title: "You were mentioned in a message",
          body: input.body,
          data: { messageId: message.id, conversationId: input.conversationId },
        },
      });
    }

    return { ...message, mentionedUserIds: validMentions };
  },
};

const DeleteInputSchema = z.object({ id: z.string() });

export const messageDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "message.delete",
  inputSchema: DeleteInputSchema,
  // No requiredPermission — ownership-only, same precedent as comment.delete.
  async resolve(input, ctx, tx) {
    const existing = await tx.message.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No message "${input.id}"`);
    if (existing.authorId !== ctx.userId) throw new ForbiddenException("You can only delete your own messages");

    return tx.message.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
  },
};

const MarkReadInputSchema = z.object({ conversationId: z.string() });

export const conversationMarkReadMutation: MutationDefinition<z.infer<typeof MarkReadInputSchema>> = {
  name: "conversation.markRead",
  inputSchema: MarkReadInputSchema,
  async resolve(input, ctx, tx) {
    await assertConversationMember(tx, ctx, input.conversationId);

    return tx.conversationMember.update({
      where: { conversationId_userId: { conversationId: input.conversationId, userId: ctx.userId } },
      data: { lastReadAt: new Date() },
    });
  },
};
