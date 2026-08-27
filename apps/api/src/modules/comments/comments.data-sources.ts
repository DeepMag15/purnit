import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { assertCommentTargetInScope, ENTITY_TYPES, getMentionableUserIds } from "./comments.mutations";

async function withAuthorNamesAndMentions(tx: PrismaTx, tenantId: string, comments: { id: string; authorId: string }[]) {
  const authorIds = [...new Set(comments.map((c) => c.authorId))];
  // ⚠️ `tenantId` added by the Comments review. This resolved author names by
  // id alone, leaving Postgres RLS as the only thing keeping the lookup inside
  // the tenant. ARCHITECTURE.md §1 principle 5 asks for both — "RLS + explicit
  // application-layer scoping on every query" — and every other resolver in
  // this module already filtered. Defense in depth is only defense in depth
  // when both layers are actually present.
  const authors = authorIds.length > 0 ? await tx.user.findMany({ where: { id: { in: authorIds }, tenantId }, select: { id: true, displayName: true } }) : [];
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
    const { authorNameById, mentionsByComment } = await withAuthorNamesAndMentions(tx, ctx.tenantId, comments);

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

/**
 * Who this comment box may actually @-mention.
 *
 * ⚠️ Why this exists. `comment.create` accepts any of the target project's
 * owner + members, and every surface fed its picker from somewhere different
 * — and mostly wrong. Verified in the browser and in source:
 *
 *   | surface              | offered                    |
 *   |----------------------|----------------------------|
 *   | ProjectDetail        | project.members            |
 *   | DocumentDetail       | project.members            |
 *   | TaskDetail           | the assignee, and nobody else |
 *   | ClientDetail         | the account manager only   |
 *   | CourseDetail         | the teacher only           |
 *   | InventoryItemDetail  | nothing — no control rendered |
 *
 * So a teacher reviewing a submission could @-mention exactly one person, and
 * in Manufacturing nobody could @-mention at all. That interacted badly with
 * the notification gap fixed alongside this: the only way to notify someone
 * was to @-mention them, and the picker made it impossible.
 *
 * ⚠️ `project.members` is deliberately NOT reused, though it looks like the
 * obvious fit: it returns `ProjectMember` rows **only, not the owner**. On a
 * student's submissions project the student IS the owner, so a teacher's
 * picker built from it would silently drop the one person the conversation is
 * with. This returns the same set `comment.create` validates against —
 * `getMentionableUserIds` — so the picker and the mutation cannot disagree.
 *
 * Ungated for the same reason as `comments.list`: reaching the thread IS the
 * gate, and `assertCommentTargetInScope` enforces it.
 */
export const commentMentionCandidatesDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "comments.mentionCandidates",
  paramsSchema: ListParamsSchema,
  async resolve(params, ctx, tx) {
    await assertCommentTargetInScope(tx, ctx, params.entityType, params.entityId);

    const ids = (await getMentionableUserIds(tx, ctx.tenantId, params.entityType, params.entityId)).filter((id) => id !== ctx.userId);
    if (ids.length === 0) return [];
    return tx.user.findMany({
      where: { id: { in: ids }, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
  },
};
