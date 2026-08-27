import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { tasksWhere } from "../tasks/tasks.data-sources";
import { assertProjectVisible } from "../documents/documents.data-sources";

export const ENTITY_TYPES = ["project", "task", "document"] as const;
export type CommentEntityType = (typeof ENTITY_TYPES)[number];

/**
 * May this person take part in the conversation on this thing?
 *
 * ⚠️ **This used to be a private re-implementation, and it drifted.** The
 * project and document branches were a hand-copied version of
 * `assertProjectVisible`, added "to avoid a circular import" — and when the
 * Documents review (2026-08-26) changed the real one to answer **404** for
 * both "no such project" and "not yours", this copy kept answering **403**.
 * Verified live before the fix: a teacher refused access to another
 * student's submissions folder got 404 from Documents and 403 from Comments,
 * so guessing ids told them which restricted folders exist. The access
 * boundary held throughout; what leaked was existence.
 *
 * It now calls the shared `assertProjectVisible` — there is no cycle, because
 * `documents.data-sources.ts` imports from `projects`, never from here. Two
 * definitions of one rule will drift; ARCHITECTURE.md §15.1 says so, and this
 * is the second module in a row to prove it.
 *
 * ⚠️ **And it locked people out of conversations about their own work.** The
 * task branch resolved scope through `tasksWhere`, which needs a `task:read`
 * grant. A **Student holds none** — by design, they reach their own work
 * through ownership, not scope. So a student could comment on their
 * submissions *project* and on their own uploaded *document*, but was refused
 * 403 on the submission **task**, which is exactly where their teacher's
 * review conversation lives. Their own page read "Task not found, or you
 * don't have access to it."
 *
 * The floor below fixes that the way this codebase fixes ownership questions
 * everywhere else — being the assignee, or owning/belonging to the project the
 * work sits in, is its own reason to be in the room. It is checked **after**
 * project reachability, so a restricted project still refuses outsiders: the
 * floor widens who may join a conversation, never which projects are visible.
 *
 * Deliberately no static `requiredPermission`: the real gate depends on
 * `entityType`, which a static field cannot express — the same bespoke-check
 * idiom `department.create`/`team.create` use.
 */
export async function assertCommentTargetInScope(
  tx: PrismaTx,
  ctx: DataSourceContext,
  entityType: CommentEntityType,
  entityId: string,
): Promise<void> {
  if (entityType === "project") {
    await assertProjectVisible(tx, ctx, entityId);
    return;
  }
  if (entityType === "document") {
    const document = await tx.document.findFirst({ where: { id: entityId, tenantId: ctx.tenantId, deletedAt: null }, select: { projectId: true } });
    if (!document) throw new NotFoundException(`No document "${entityId}"`);
    await assertProjectVisible(tx, ctx, document.projectId);
    return;
  }

  const task = await tx.task.findFirst({
    where: { id: entityId, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, projectId: true, assigneeId: true },
  });
  if (!task) throw new NotFoundException(`No task "${entityId}"`);

  // Reachability first, and it is the only thing that decides what is
  // *visible*: a task in a restricted project is refused here regardless of
  // any floor below.
  await assertProjectVisible(tx, ctx, task.projectId);

  // Then: scope, or one of the two ownership floors.
  const where = await tasksWhere(tx, ctx, {});
  const inScope = where ? await tx.task.findFirst({ where: { ...where, id: entityId }, select: { id: true } }) : null;
  if (inScope) return;
  if (task.assigneeId && task.assigneeId === ctx.userId) return;
  if (await isProjectOwnerOrMember(tx, ctx, task.projectId)) return;

  // 404, not 403 — same one-answer-for-both-cases rule as every branch above.
  throw new NotFoundException(`No task "${entityId}"`);
}

/** Owning a project, or being named on it, is its own reason to be in its
 * conversations — the membership floor `requireTaskInScope` and the document
 * writes already carry, applied to Comments. */
async function isProjectOwnerOrMember(tx: PrismaTx, ctx: DataSourceContext, projectId: string): Promise<boolean> {
  if (!ctx.userId) return false;
  const owned = await tx.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId, ownerId: ctx.userId }, select: { id: true } });
  if (owned) return true;
  const member = await tx.projectMember.findFirst({ where: { projectId, userId: ctx.userId }, select: { id: true } });
  return !!member;
}

/**
 * Resolves the set of user ids a comment on this entity may actually
 * @-mention: the target's own project's owner + `ProjectMember`s (a task
 * inherits its project's membership) — the same membership boundary
 * `assertAssigneeIsProjectMember` already enforces for task assignment,
 * generalized to a set-membership check. Invalid/non-member ids are
 * silently dropped, not hard-errored — same graceful-join precedent as
 * `withOwnerNames`/`withMembers` in `projects.data-sources.ts`; a client
 * mis-mentioning someone shouldn't fail the whole comment. Self-mentions
 * are dropped too (`notificationRecipientFor`'s exact "telling someone
 * about their own action isn't a notification" reasoning).
 */
export function resolveValidMentions(requestedUserIds: string[], projectMemberIds: string[], authorId: string): string[] {
  const valid = new Set(projectMemberIds);
  return [...new Set(requestedUserIds)].filter((id) => id !== authorId && valid.has(id));
}

async function resolveProjectIdForEntity(tx: PrismaTx, tenantId: string, entityType: CommentEntityType, entityId: string): Promise<string | null> {
  if (entityType === "project") return entityId;
  if (entityType === "document") {
    const document = await tx.document.findFirst({ where: { id: entityId, tenantId }, select: { projectId: true } });
    return document?.projectId ?? null;
  }
  const task = await tx.task.findFirst({ where: { id: entityId, tenantId }, select: { projectId: true } });
  return task?.projectId ?? null;
}

/** Exported as `getMentionableUserIds` for `comments.mentionCandidates`, so
 * the picker offers exactly the set this file validates against. */
export async function getMentionableUserIds(tx: PrismaTx, tenantId: string, entityType: CommentEntityType, entityId: string): Promise<string[]> {
  const projectId = await resolveProjectIdForEntity(tx, tenantId, entityType, entityId);
  if (!projectId) return [];
  const project = await tx.project.findFirst({ where: { id: projectId, tenantId }, select: { ownerId: true, members: { select: { userId: true } } } });
  if (!project) return [];
  const ids = project.members.map((m) => m.userId);
  if (project.ownerId) ids.push(project.ownerId);
  return ids;
}

/**
 * Whose work is this? A task's assignee, a document's uploader, a project's
 * owner — the one person a comment is most likely to be *for*.
 *
 * Null is a normal answer: an unassigned task, or a project with no owner,
 * simply has nobody to notify.
 */
async function resolveWorkOwner(tx: PrismaTx, tenantId: string, entityType: CommentEntityType, entityId: string): Promise<string | null> {
  if (entityType === "task") {
    const task = await tx.task.findFirst({ where: { id: entityId, tenantId }, select: { assigneeId: true } });
    return task?.assigneeId ?? null;
  }
  if (entityType === "document") {
    const doc = await tx.document.findFirst({ where: { id: entityId, tenantId }, select: { uploadedById: true } });
    return doc?.uploadedById ?? null;
  }
  const project = await tx.project.findFirst({ where: { id: entityId, tenantId }, select: { ownerId: true } });
  return project?.ownerId ?? null;
}

const CreateInputSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string(),
  body: z.string().min(1).max(2000),
  mentionedUserIds: z.array(z.string()).optional(),
});

export const commentCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "comment.create",
  inputSchema: CreateInputSchema,
  async resolve(input, ctx, tx) {
    await assertCommentTargetInScope(tx, ctx, input.entityType, input.entityId);

    const comment = await tx.comment.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        authorId: ctx.userId,
        body: input.body,
      },
    });

    const memberIds = await getMentionableUserIds(tx, ctx.tenantId, input.entityType, input.entityId);
    const validMentions = resolveValidMentions(input.mentionedUserIds ?? [], memberIds, ctx.userId);

    // Sequential, not `Promise.all` — concurrent queries against the same
    // transactional `tx` are unsafe (one reserved connection per
    // transaction); see the comment in rbac/role-hierarchy.ts for the real
    // bug this caused elsewhere.
    for (const userId of validMentions) {
      await tx.commentMention.create({ data: { tenantId: ctx.tenantId, commentId: comment.id, userId } });
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId,
          type: "comment.mention",
          title: "You were mentioned in a comment",
          body: input.body,
          data: { commentId: comment.id, entityType: input.entityType, entityId: input.entityId },
        },
      });
    }

    /**
     * ⚠️ The half of "comment → notification → response" that was missing.
     *
     * Only an explicit @mention produced a notification. Verified live: a
     * teacher commented on a student's submission and the student's
     * notifications table stayed empty — so the review conversation ran with
     * one participant unaware it was happening. The same held everywhere:
     * comment on someone's task or document and they learned nothing.
     *
     * It mattered more than it looks, because on most surfaces @mentioning
     * them was not even possible — the pickers offered one person or none
     * (see `comments.mentionCandidates`). The author had no way to notify
     * the one person who most needed to know.
     *
     * Deliberately narrow: the person whose work this is — a task's
     * assignee, a document's uploader, a project's owner — and nobody else.
     * Notifying every project member on every comment would be the kind of
     * noise that teaches people to ignore the bell. Anyone already
     * @mentioned is skipped rather than told twice, and the author is never
     * notified about their own comment (`notificationRecipientFor`'s
     * existing rule).
     */
    const alreadyNotified = new Set([...validMentions, ctx.userId]);
    const owner = await resolveWorkOwner(tx, ctx.tenantId, input.entityType, input.entityId);
    if (owner && !alreadyNotified.has(owner)) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: owner,
          type: "comment.created",
          title: "New comment on your work",
          body: input.body,
          data: { commentId: comment.id, entityType: input.entityType, entityId: input.entityId },
        },
      });
    }

    return { ...comment, mentionedUserIds: validMentions };
  },
};

const DeleteInputSchema = z.object({ id: z.string() });

export const commentDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "comment.delete",
  inputSchema: DeleteInputSchema,
  // No requiredPermission — ownership-only, same precedent as
  // notification.markRead: a comment's author (and only its author) may
  // delete it, no broader "manage" grant substitutes for this.
  async resolve(input, ctx, tx) {
    const existing = await tx.comment.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No comment "${input.id}"`);
    if (existing.authorId !== ctx.userId) throw new ForbiddenException("You can only delete your own comments");

    return tx.comment.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
  },
};
