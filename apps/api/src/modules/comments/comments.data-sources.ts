import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { assertCommentTargetInScope, ENTITY_TYPES } from "./comments.mutations";

async function withAuthorNamesAndMentions(tx: PrismaTx, comments: { id: string; authorId: string }[]) {
  const authorIds = [...new Set(comments.map((c) => c.authorId))];
  const authors = authorIds.length > 0 ? await tx.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true } }) : [];
  const authorNameById = new Map(authors.map((a) => [a.id, a.displayName]));

  const commentIds = comments.map((c) => c.id);
  const mentions = commentIds.length > 0 ? await tx.commentMention.findMany({ where: { commentId: { in: commentIds } } }) : [];
  const mentionsByComment = new Map<string, string[]>();
  for (const m of mentions) {
    const list = mentionsByComment.get(m.commentId) ?? [];
    list.push(m.userId);
    mentionsByComment.set(m.commentId, list);
  }

  return { authorNameById, mentionsByComment };
}

const ListParamsSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string(),
});

// No requiredPermission — same reasoning as comment.create/comment.delete
// (comments.mutations.ts): the real gate (project:read vs task:read)
// depends on entityType, resolved inside assertCommentTargetInScope by
// reusing projectsWhere/tasksWhere directly, not a static field.
export const commentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "comments.list",
  paramsSchema: ListParamsSchema,
  async resolve(params, ctx, tx) {
    await assertCommentTargetInScope(tx, ctx, params.entityType, params.entityId);

    const comments = await tx.comment.findMany({
      where: { tenantId: ctx.tenantId, entityType: params.entityType, entityId: params.entityId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    // Sequential, not Promise.all — same shared-tx safety rule as every
    // other multi-query resolver in this codebase.
    const { authorNameById, mentionsByComment } = await withAuthorNamesAndMentions(tx, comments);

    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorId: c.authorId,
      authorName: authorNameById.get(c.authorId) ?? "Unknown",
      createdAt: c.createdAt,
      mentionedUserIds: mentionsByComment.get(c.id) ?? [],
    }));
  },
};
