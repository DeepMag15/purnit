import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { projectsWhere } from "../projects/projects.data-sources";
import { tasksWhere } from "../tasks/tasks.data-sources";

export const ENTITY_TYPES = ["project", "task", "document"] as const;
export type CommentEntityType = (typeof ENTITY_TYPES)[number];

/**
 * Confirms a Project/Task exists and is within the actor's scope, reusing
 * the *exact* existing scope-check helpers (`projectsWhere`/`tasksWhere`) —
 * not a re-derived permission model. Two-step shape (existence, then scope)
 * mirrors `requireTaskInScope`'s own precedent in `tasks.mutations.ts`.
 * Deliberately no static `requiredPermission` on the mutations that call
 * this — the real permission (`project:read` vs `task:read`) depends on
 * `entityType`, which a static field can't express; this is the same
 * "fully bespoke inline scope check" idiom `department.create`/`team.create`
 * already use instead of the generic dispatcher.
 */
export async function assertCommentTargetInScope(
  tx: PrismaTx,
  ctx: DataSourceContext,
  entityType: CommentEntityType,
  entityId: string,
): Promise<void> {
  if (entityType === "project") {
    const existing = await tx.project.findFirst({ where: { id: entityId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No project "${entityId}"`);
    const where = await projectsWhere(tx, ctx, { id: entityId });
    const inScope = where ? await tx.project.findFirst({ where }) : null;
    if (!inScope) throw new ForbiddenException("Not allowed to comment on this project");
    return;
  }
  if (entityType === "document") {
    // A document's own visibility is entirely "can the actor see its
    // parent project" (documents.data-sources.ts's assertProjectVisible)
    // — reimplemented inline here rather than imported, to avoid a
    // circular import (documents.data-sources.ts doesn't import anything
    // from this file either).
    const document = await tx.document.findFirst({ where: { id: entityId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!document) throw new NotFoundException(`No document "${entityId}"`);
    const where = await projectsWhere(tx, ctx, { id: document.projectId });
    const inScope = where ? await tx.project.findFirst({ where }) : null;
    if (!inScope) throw new ForbiddenException("Not allowed to comment on this document");
    return;
  }
  const existing = await tx.task.findFirst({ where: { id: entityId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No task "${entityId}"`);
  const where = await tasksWhere(tx, ctx, {});
  const inScope = where ? await tx.task.findFirst({ where: { ...where, id: entityId } }) : null;
  if (!inScope) throw new ForbiddenException("Not allowed to comment on this task");
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

async function getProjectMemberIds(tx: PrismaTx, tenantId: string, entityType: CommentEntityType, entityId: string): Promise<string[]> {
  const projectId = await resolveProjectIdForEntity(tx, tenantId, entityType, entityId);
  if (!projectId) return [];
  const project = await tx.project.findFirst({ where: { id: projectId, tenantId }, select: { ownerId: true, members: { select: { userId: true } } } });
  if (!project) return [];
  const ids = project.members.map((m) => m.userId);
  if (project.ownerId) ids.push(project.ownerId);
  return ids;
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

    const memberIds = await getProjectMemberIds(tx, ctx.tenantId, input.entityType, input.entityId);
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
