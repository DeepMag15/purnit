import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { logAudit } from "../../audit/log-audit";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Only resolved when actually needed — see department-subtree.ts. Shared by
 * every `isRowInScope` call site in this file rather than repeated inline. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: MutationContext, scope: string | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

const CreateInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  departmentId: z.string().optional(),
});

export const projectCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "project.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "project:create",
  async resolve(input, ctx, tx) {
    const project = await tx.project.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        status: input.status ?? "active",
        ownerId: ctx.userId,
        departmentId: input.departmentId ?? ctx.userDepartmentId ?? undefined,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "project", project.id); // AI RAG Phase C
    return project;
  },
};

const UpdateInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.string().optional(),
});

export const projectUpdateMutation: MutationDefinition<z.infer<typeof UpdateInputSchema>> = {
  name: "project.update",
  inputSchema: UpdateInputSchema,
  requiredPermission: "project:update",
  async resolve(input, ctx, tx) {
    const existing = await tx.project.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No project "${input.id}"`);

    const scope = ctx.effective.has("project", "update");
    const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
    if (!scope || !isRowInScope(scope, existing, { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds })) {
      throw new ForbiddenException("Not allowed to update this project");
    }

    const { id, ...data } = input;
    const updated = await tx.project.update({ where: { id }, data });
    // Re-embeds on every update, not just name/description changes — a
    // status-only edit still re-enqueues, cheap and safe (the processor's
    // own content-hash diff no-ops if the extracted text is unchanged).
    await enqueueEmbeddingJob(tx, ctx.tenantId, "project", updated.id); // AI RAG Phase C
    return updated;
  },
};

const MemberInputSchema = z.object({ projectId: z.string(), userId: z.string() });

/** Fetches the project and checks the caller's `project:update` scope
 * against it — same guard `project.update`/`project.delete` already use.
 * Shared by both member mutations below rather than duplicated inline. */
async function requireUpdatableProject(tx: PrismaTx, ctx: MutationContext, projectId: string) {
  const project = await tx.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!project) throw new NotFoundException(`No project "${projectId}"`);

  const scope = ctx.effective.has("project", "update");
  const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
  if (!scope || !isRowInScope(scope, project, { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds })) {
    throw new ForbiddenException("Not allowed to manage this project's members");
  }
  return project;
}

export const projectAddMemberMutation: MutationDefinition<z.infer<typeof MemberInputSchema>> = {
  name: "project.addMember",
  inputSchema: MemberInputSchema,
  requiredPermission: "project:update",
  async resolve(input, ctx, tx) {
    await requireUpdatableProject(tx, ctx, input.projectId);

    const user = await tx.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    // Idempotent — adding an existing member is a no-op, not an error.
    const existing = await tx.projectMember.findFirst({ where: { projectId: input.projectId, userId: input.userId } });
    if (!existing) {
      await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: input.projectId, userId: input.userId } });
    }
    return { success: true };
  },
};

export const projectRemoveMemberMutation: MutationDefinition<z.infer<typeof MemberInputSchema>> = {
  name: "project.removeMember",
  inputSchema: MemberInputSchema,
  requiredPermission: "project:update",
  async resolve(input, ctx, tx) {
    await requireUpdatableProject(tx, ctx, input.projectId);
    await tx.projectMember.deleteMany({ where: { projectId: input.projectId, userId: input.userId } });
    return { success: true };
  },
};

const DeleteInputSchema = z.object({ id: z.string() });

export const projectDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "project.delete",
  inputSchema: DeleteInputSchema,
  requiredPermission: "project:delete",
  async resolve(input, ctx, tx) {
    const existing = await tx.project.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`No project "${input.id}"`);

    const scope = ctx.effective.has("project", "delete");
    const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
    if (!scope || !isRowInScope(scope, existing, { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds })) {
      throw new ForbiddenException("Not allowed to delete this project");
    }

    await tx.project.update({ where: { id: input.id }, data: { deletedAt: new Date() } });

    // Audit Logs (module 6 of 6) — deletes are one of the bounded, high-value
    // categories this module exists for.
    await logAudit(tx, ctx, { action: "project.delete", resource: "project", resourceId: input.id, before: { name: existing.name } });

    return { success: true };
  },
};
