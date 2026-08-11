import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";

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

    return tx.enrollment.create({
      data: { tenantId: ctx.tenantId, studentId: input.studentId, courseId: input.courseId, enrolledById: ctx.userId },
    });
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const enrollmentUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "enrollment.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "enrollment:update",
  async resolve(input, ctx, tx) {
    const existing = await requireEnrollmentInScope(tx, ctx, input.id);
    return tx.enrollment.update({ where: { id: existing.id }, data: { status: input.status } });
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
    return tx.enrollment.update({ where: { id: existing.id }, data: { finalGrade: input.finalGrade } });
  },
};
