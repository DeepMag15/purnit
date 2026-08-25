import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Same `requirePatientInScope` shape every module follows — defensive, not
 * exercised in Phase A (only Admin/Registrar hold `enrollment:update`, both
 * `:tenant`). */
async function requireEnrollmentInScope(tx: PrismaTx, ctx: MutationContext, enrollmentId: string) {
  const existing = await tx.enrollment.findFirst({ where: { id: enrollmentId, tenantId: ctx.tenantId } });
  if (!existing) throw new NotFoundException(`No enrollment "${enrollmentId}"`);

  const scope = ctx.effective.has("enrollment", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.enrolledById }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this enrollment");
  return existing;
}

const EnrollInputSchema = z.object({ studentId: z.string(), courseId: z.string() });

export const enrollmentEnrollMutation: MutationDefinition<z.infer<typeof EnrollInputSchema>> = {
  name: "enrollment.enroll",
  inputSchema: EnrollInputSchema,
  requiredPermission: "enrollment:create",
  async resolve(input, ctx, tx) {
    const student = await tx.student.findFirst({ where: { id: input.studentId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!student) throw new NotFoundException(`No student "${input.studentId}"`);
    const course = await tx.course.findFirst({ where: { id: input.courseId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!course) throw new NotFoundException(`No course "${input.courseId}"`);

    const existing = await tx.enrollment.findFirst({ where: { studentId: input.studentId, courseId: input.courseId } });
    if (existing) throw new BadRequestException("Already has an enrollment record for this course — update its status instead");

    const enrollment = await tx.enrollment.create({
      data: { tenantId: ctx.tenantId, studentId: input.studentId, courseId: input.courseId, enrolledById: ctx.userId },
    });

    // Student Role (2026-08-25) — enrolling a student who has a login also
    // gives them the course's materials.
    //
    // Course materials are Documents on the Course's own `materialsProject`,
    // and `assertProjectVisible` resolves membership against real User rows.
    // Before `Student.userId` existed a student had no User to add, which is
    // why this step could not have existed earlier. Doing it here rather than
    // in a student-specific document source means the whole existing
    // documents module serves students with no new read path — and, more
    // importantly, un-enrolling is the only thing that needs to revoke access.
    //
    // Silent when the student has no login yet: enrolment must not fail
    // because the school has not issued a portal account.
    if (student.userId) {
      const alreadyMember = await tx.projectMember.findFirst({
        where: { projectId: course.materialsProjectId, userId: student.userId },
      });
      if (!alreadyMember) {
        await tx.projectMember.create({
          data: { tenantId: ctx.tenantId, projectId: course.materialsProjectId, userId: student.userId },
        });
      }
    }

    await enqueueEmbeddingJob(tx, ctx.tenantId, "enrollment", enrollment.id); // AI RAG Phase C
    return enrollment;
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const enrollmentUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "enrollment.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "enrollment:update",
  async resolve(input, ctx, tx) {
    const existing = await requireEnrollmentInScope(tx, ctx, input.id);
    const updated = await tx.enrollment.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "enrollment", updated.id); // AI RAG Phase C
    return updated;
  },
};

const RecordFinalGradeInputSchema = z.object({ id: z.string(), finalGrade: z.string().min(1) });

/** Same permission as `enrollment.updateStatus`, distinct mutation — mirrors
 * Patient's `updateStatus`/`assignDoctor` split (separate concerns, not
 * merged into one catch-all update). */
export const enrollmentRecordFinalGradeMutation: MutationDefinition<z.infer<typeof RecordFinalGradeInputSchema>> = {
  name: "enrollment.recordFinalGrade",
  inputSchema: RecordFinalGradeInputSchema,
  requiredPermission: "enrollment:update",
  async resolve(input, ctx, tx) {
    const existing = await requireEnrollmentInScope(tx, ctx, input.id);
    const updated = await tx.enrollment.update({ where: { id: existing.id }, data: { finalGrade: input.finalGrade } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "enrollment", updated.id); // AI RAG Phase C
    return updated;
  },
};
