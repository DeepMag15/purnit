import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@purnit/manifest-schema";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { logAudit } from "../../audit/log-audit";

/** Only resolved when actually needed — see department-subtree.ts. Same
 * local-helper precedent as meetings.mutations.ts's own resolveSubtreeIds. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: MutationContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

/** Resolves every recipient for a target: the target department's full
 * subtree (walked DOWN from the target — the natural direction here, since
 * there's exactly one target per post, unlike announcementsWhere's
 * per-reader ancestor-chain check) or, for a tenant-wide post, everyone in
 * the tenant. */
async function resolveAudienceUserIds(tx: PrismaTx, tenantId: string, departmentId: string | null): Promise<string[]> {
  const where = departmentId
    ? { tenantId, deletedAt: null, departmentId: { in: await getDepartmentSubtreeIds(tx, tenantId, departmentId) } }
    : { tenantId, deletedAt: null };
  const rows = await tx.user.findMany({ where, select: { id: true } });
  return rows.map((r) => r.id);
}

const CreateInputSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  // Omitted = tenant-wide intent — only valid when the actor's granted
  // scope is "tenant". A department/department-subtree-scoped actor
  // targeting `null` naturally fails the isRowInScope check below with no
  // extra branch, since its department/department-subtree cases require a
  // non-null subject.departmentId.
  departmentId: z.string().optional(),
});

export const announcementCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "announcement.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "announcement:create",
  async resolve(input, ctx, tx) {
    const scope = ctx.effective.has("announcement", "create");
    if (!scope) throw new ForbiddenException('Missing permission "announcement:create"');

    const targetDepartmentId = input.departmentId ?? null;
    const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
    const inScope = isRowInScope(
      scope,
      { ownerId: null, departmentId: targetDepartmentId },
      { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
    );
    if (!inScope) throw new ForbiddenException("Not allowed to post an announcement to this target");

    const announcement = await tx.announcement.create({
      data: { tenantId: ctx.tenantId, authorId: ctx.userId, departmentId: targetDepartmentId, title: input.title, body: input.body },
    });

    const audienceIds = await resolveAudienceUserIds(tx, ctx.tenantId, targetDepartmentId);
    const recipients = audienceIds.filter((id) => id !== ctx.userId);
    if (recipients.length > 0) {
      // One batched multi-row insert, not a sequential loop — the audience
      // here can be a real broadcast (a whole department subtree or the
      // whole tenant), unlike every existing notification call site's
      // small, hand-picked recipient list. A sequential loop of this shape
      // is exactly what already caused materializeDepartmentTypeLabels to
      // blow its transaction timeout at 47 rows (CONTEXT.md) — createMany
      // is one statement, not N round-trips.
      await tx.notification.createMany({
        data: recipients.map((userId) => ({
          tenantId: ctx.tenantId,
          userId,
          type: "announcement.posted",
          title: "New announcement",
          body: announcement.title,
          data: { announcementId: announcement.id },
        })),
      });
    }

    return announcement;
  },
};

const DeleteInputSchema = z.object({ id: z.string() });

// No requiredPermission — ownership-only, same precedent as
// comment.delete/message.delete. Admin-can-delete-anyone's-post
// (moderation) was considered and deferred, not built here.
export const announcementDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "announcement.delete",
  inputSchema: DeleteInputSchema,
  async resolve(input, ctx, tx) {
    const existing = await tx.announcement.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No announcement "${input.id}"`);
    if (existing.authorId !== ctx.userId) throw new ForbiddenException("You can only delete your own announcements");

    const updated = await tx.announcement.update({ where: { id: input.id }, data: { deletedAt: new Date() } });

    // Audit Logs (module 6 of 6) — included despite being ownership-gated,
    // not permission-gated (unlike this list's other deletes): an
    // announcement is tenant-wide visible content, so "who deleted this and
    // when" carries real accountability value regardless of what authority
    // let them do it.
    await logAudit(tx, ctx, { action: "announcement.delete", resource: "announcement", resourceId: input.id, before: { title: existing.title } });

    return updated;
  },
};
