import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Same `requirePatientInScope` shape every module follows. Unlike Assignment
 * (whose "owner" is transitive through Course), Course has a direct owner
 * field (`teacherId`), so a plain `isRowInScope` call is correct here — this
 * branch IS live in Phase A: Teacher holds `course:update:own`. */
async function requireCourseInScope(tx: PrismaTx, ctx: MutationContext, courseId: string) {
  const existing = await tx.course.findFirst({ where: { id: courseId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No course "${courseId}"`);

  const scope = ctx.effective.has("course", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.teacherId }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this course");
  return existing;
}

const CreateInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  teacherId: z.string().optional(),
});

/** Creates the Course row and its backing "materials" Project in one
 * transaction — verbatim structural mirror of `patient.register`. Admin-only
 * in Phase A (Teacher never holds `course:create`, mirrors Doctor never
 * holding `patient:create`) — Course creation stays an administrative act,
 * avoiding ad-hoc unofficial courses. */
export const courseCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "course.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "course:create",
  async resolve(input, ctx, tx) {
    if (input.teacherId) {
      const teacher = await tx.user.findFirst({ where: { id: input.teacherId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!teacher) throw new NotFoundException(`No user "${input.teacherId}"`);
    }

    const materialsProject = await tx.project.create({
      data: { tenantId: ctx.tenantId, name: `Materials: ${input.name}`, status: "active", ownerId: ctx.userId, kind: "materials" },
    });

    const course = await tx.course.create({
      data: {
        tenantId: ctx.tenantId,
        materialsProjectId: materialsProject.id,
        name: input.name,
        description: input.description,
        teacherId: input.teacherId,
      },
    });

    if (input.teacherId) {
      await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: materialsProject.id, userId: input.teacherId } });
    }

    await enqueueEmbeddingJob(tx, ctx.tenantId, "course", course.id); // AI RAG Phase C
    return course;
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const courseUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "course.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "course:update",
  async resolve(input, ctx, tx) {
    const existing = await requireCourseInScope(tx, ctx, input.id);
    const updated = await tx.course.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "course", updated.id); // AI RAG Phase C
    return updated;
  },
};

const AssignTeacherInputSchema = z.object({ id: z.string(), teacherId: z.string() });

/** Mirrors `patient.assignDoctor` exactly. */
export const courseAssignTeacherMutation: MutationDefinition<z.infer<typeof AssignTeacherInputSchema>> = {
  name: "course.assignTeacher",
  inputSchema: AssignTeacherInputSchema,
  requiredPermission: "course:update",
  async resolve(input, ctx, tx) {
    const existing = await requireCourseInScope(tx, ctx, input.id);
    const teacher = await tx.user.findFirst({ where: { id: input.teacherId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!teacher) throw new NotFoundException(`No user "${input.teacherId}"`);

    const updated = await tx.course.update({ where: { id: existing.id }, data: { teacherId: input.teacherId } });

    // Idempotent — same "adding an existing member is a no-op" precedent as
    // project.addMember.
    const existingMember = await tx.projectMember.findFirst({ where: { projectId: existing.materialsProjectId, userId: input.teacherId } });
    if (!existingMember) {
      await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: existing.materialsProjectId, userId: input.teacherId } });
    }

    return updated;
  },
};
