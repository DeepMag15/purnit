import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Same `requirePatientInScope` shape every module in this codebase already
 * follows. A Student's "owner" for scope purposes is whoever registered
 * them — defensive, not exercised in Phase A (every role holding
 * `student:update` holds it `:tenant`; see students.data-sources.ts). */
async function requireStudentInScope(tx: PrismaTx, ctx: MutationContext, studentId: string) {
  const existing = await tx.student.findFirst({ where: { id: studentId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No student "${studentId}"`);

  const scope = ctx.effective.has("student", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.registeredById }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this student");
  return existing;
}

const RegisterInputSchema = z.object({
  name: z.string().min(1),
  dateOfBirth: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
});

/** Plain create — deliberately NO backing Project (unlike `patient.register`,
 * see student.prisma's own doc comment for why Course, not Student, owns the
 * shared-materials Project in this domain). */
export const studentRegisterMutation: MutationDefinition<z.infer<typeof RegisterInputSchema>> = {
  name: "student.register",
  inputSchema: RegisterInputSchema,
  requiredPermission: "student:create",
  async resolve(input, ctx, tx) {
    // Contextual Reporting (2026-08-25) — the student's own file, backed by a
    // Project so Documents and Comments attach through machinery that already
    // resolves scope. Created eagerly, exactly as course.create/patient.register
    // create theirs: students are registered one at a time, so this is one
    // extra row per registration, not a bulk backfill.
    const filesProject = await tx.project.create({
      data: {
        tenantId: ctx.tenantId,
        name: `Student file: ${input.name}`,
        status: "active",
        ownerId: ctx.userId,
        // Answers the privacy caveat this file's own comment raised: without
        // this, every Teacher and Teaching Assistant holding `project:read:tenant`
        // could read a student's enrolment paperwork. `student:update` is the
        // registrar floor — Registrar and School Administrator hold it,
        // teaching staff do not.
        restricted: true,
        accessPermission: "student:update",
      },
    });

    const student = await tx.student.create({
      data: {
        tenantId: ctx.tenantId,
        filesProjectId: filesProject.id,
        name: input.name,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        registeredById: ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "student", student.id); // AI RAG Phase C
    return student;
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const studentUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "student.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "student:update",
  async resolve(input, ctx, tx) {
    const existing = await requireStudentInScope(tx, ctx, input.id);
    const updated = await tx.student.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "student", updated.id); // AI RAG Phase C
    return updated;
  },
};
