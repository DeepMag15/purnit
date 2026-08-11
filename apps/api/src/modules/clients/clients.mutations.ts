import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";

/** Same `requireCourseInScope` shape every module follows. A Client's
 * "owner" for scope purposes is its account manager — a LIVE branch in
 * Phase A (Sales Rep holds `client:update:own`, unlike Teacher's own
 * inert equivalent in Education). */
async function requireClientInScope(tx: PrismaTx, ctx: MutationContext, clientId: string) {
  const existing = await tx.client.findFirst({ where: { id: clientId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No client "${clientId}"`);

  const scope = ctx.effective.has("client", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.accountManagerId }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this client");
  return existing;
}

const CreateInputSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  accountManagerId: z.string().optional(),
});

/** Creates the Client row and its backing "files" Project in one
 * transaction — verbatim structural mirror of `course.create`/`patient.register`.
 * `accountManagerId` defaults to the creator — meaning a Sales Rep creating
 * their own client becomes its owner immediately, the real (non-inert)
 * `:own` scope this domain's design relies on. */
export const clientCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "client.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "client:create",
  async resolve(input, ctx, tx) {
    if (input.accountManagerId) {
      const manager = await tx.user.findFirst({ where: { id: input.accountManagerId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!manager) throw new NotFoundException(`No user "${input.accountManagerId}"`);
    }
    const accountManagerId = input.accountManagerId ?? ctx.userId;

    const filesProject = await tx.project.create({
      data: { tenantId: ctx.tenantId, name: `Files: ${input.name}`, status: "active", ownerId: accountManagerId },
    });

    const client = await tx.client.create({
      data: {
        tenantId: ctx.tenantId,
        filesProjectId: filesProject.id,
        name: input.name,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        accountManagerId,
        createdById: ctx.userId,
      },
    });

    await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: filesProject.id, userId: accountManagerId } });

    return client;
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const clientUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "client.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "client:update",
  async resolve(input, ctx, tx) {
    const existing = await requireClientInScope(tx, ctx, input.id);
    return tx.client.update({ where: { id: existing.id }, data: { status: input.status } });
  },
};

const AssignAccountManagerInputSchema = z.object({ id: z.string(), accountManagerId: z.string() });

/** Mirrors `course.assignTeacher` exactly, including the Files Project
 * membership side-effect. */
export const clientAssignAccountManagerMutation: MutationDefinition<z.infer<typeof AssignAccountManagerInputSchema>> = {
  name: "client.assignAccountManager",
  inputSchema: AssignAccountManagerInputSchema,
  requiredPermission: "client:update",
  async resolve(input, ctx, tx) {
    const existing = await requireClientInScope(tx, ctx, input.id);
    const manager = await tx.user.findFirst({ where: { id: input.accountManagerId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!manager) throw new NotFoundException(`No user "${input.accountManagerId}"`);

    const updated = await tx.client.update({ where: { id: existing.id }, data: { accountManagerId: input.accountManagerId } });

    // Idempotent — same "adding an existing member is a no-op" precedent as
    // project.addMember.
    const existingMember = await tx.projectMember.findFirst({ where: { projectId: existing.filesProjectId, userId: input.accountManagerId } });
    if (!existingMember) {
      await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: existing.filesProjectId, userId: input.accountManagerId } });
    }

    return updated;
  },
};
