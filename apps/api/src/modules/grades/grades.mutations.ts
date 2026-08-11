import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { isRowInScope } from "../../rbac/scope-check";
import { requireAssignmentInScope } from "../assignments/assignments.mutations";

const RecordInputSchema = z.object({
  assignmentId: z.string(),
  studentId: z.string(),
  score: z.number().int().min(0),
  feedback: z.string().optional(),
});

/** The FIRST score entry for an (assignment, student) pair — see grade.prisma
 * and this module's own doc comment on `grade.update` for why grade-entry is
 * split into two mutations instead of one create-or-update upsert.
 * `gradedById` is null pre-entry, so scope here is resolved transitively via
 * `requireAssignmentInScope` (Course → Assignment), never by reading
 * `existing.gradedById` — there IS no existing row yet. */
export const gradeRecordMutation: MutationDefinition<z.infer<typeof RecordInputSchema>> = {
  name: "grade.record",
  inputSchema: RecordInputSchema,
  requiredPermission: "grade:create",
  async resolve(input, ctx, tx) {
    const assignment = await requireAssignmentInScope(tx, ctx, input.assignmentId, { resource: "grade", action: "create" });

    if (input.score > assignment.maxScore) {
      throw new BadRequestException(`Score cannot exceed this assignment's max score (${assignment.maxScore})`);
    }

    const enrollment = await tx.enrollment.findFirst({
      where: { tenantId: ctx.tenantId, studentId: input.studentId, courseId: assignment.courseId, status: "enrolled" },
    });
    if (!enrollment) throw new NotFoundException(`No active enrollment for student "${input.studentId}" in this course`);

    const existing = await tx.grade.findFirst({ where: { assignmentId: input.assignmentId, studentId: input.studentId } });
    if (existing) throw new BadRequestException("This student already has a grade for this assignment — use grade.update instead");

    return tx.grade.create({
      data: {
        tenantId: ctx.tenantId,
        assignmentId: input.assignmentId,
        studentId: input.studentId,
        score: input.score,
        feedback: input.feedback,
        gradedById: ctx.userId,
        gradedAt: new Date(),
      },
    });
  },
};

const UpdateInputSchema = z.object({
  id: z.string(),
  score: z.number().int().min(0).optional(),
  feedback: z.string().optional(),
});

/** Corrects an ALREADY-graded entry. `gradedById` is guaranteed non-null by
 * this point (set by `grade.record`), so — unlike `grade.record` — the
 * literal `isRowInScope(scope, {ownerId: existing.gradedById}, ...)` mirror
 * of `appointment.updateStatus` is correct here, not buggy. */
export const gradeUpdateMutation: MutationDefinition<z.infer<typeof UpdateInputSchema>> = {
  name: "grade.update",
  inputSchema: UpdateInputSchema,
  requiredPermission: "grade:update",
  async resolve(input, ctx, tx) {
    const existing = await tx.grade.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!existing) throw new NotFoundException(`No grade "${input.id}"`);

    const scope = ctx.effective.has("grade", "update");
    const inScope = scope && isRowInScope(scope, { ownerId: existing.gradedById }, { userId: ctx.userId });
    if (!inScope) throw new ForbiddenException("Not allowed to update this grade");

    if (input.score != null) {
      const assignment = await tx.assignment.findFirst({ where: { id: existing.assignmentId } });
      if (assignment && input.score > assignment.maxScore) {
        throw new BadRequestException(`Score cannot exceed this assignment's max score (${assignment.maxScore})`);
      }
    }

    return tx.grade.update({
      where: { id: existing.id },
      data: {
        score: input.score,
        feedback: input.feedback,
        gradedById: ctx.userId,
        gradedAt: new Date(),
      },
    });
  },
};
