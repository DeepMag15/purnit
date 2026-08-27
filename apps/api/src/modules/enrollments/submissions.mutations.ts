import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueDocumentEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/**
 * Education — a student hands work in.
 *
 * ⚠️ What this closes. `Enrollment.submissionsProjectId` has existed since
 * Contextual Reporting (2026-08-25) and the restricted-projects fix
 * (2026-08-26) was built specifically to protect it — student-owned,
 * teacher-as-member, no `accessPermission` so no role can read every
 * student's work. And nothing could reach it: there was no submission path in
 * the Student portal at all, and `myAssignments.list` said so outright ("this
 * platform has no student submission model"). Every enrollment created an
 * empty restricted project that nothing ever wrote to.
 *
 * ⚠️ And it is deliberately NOT a new workflow. A submission is an ordinary
 * **Task** — assigned to the student, sitting in their own submissions
 * project, carrying the uploaded work as evidence via `Document.taskId` —
 * moved through the same `task.submitForReview` / `task.review` pair every
 * other domain uses. The teacher needs no new queue: they are already a member
 * of the submissions project, and `tasksWhere`'s membership floor (added by
 * the Projects review) puts the task in their list automatically.
 *
 * What IS Education-specific is the vocabulary and who may act:
 *   - the student submits against an **assignment**, not a task id they should
 *     never have to know;
 *   - only against an assignment on a course they are actually enrolled in;
 *   - the teacher of record reviews it, because they are the project's member.
 */

const SubmitInputSchema = z.object({
  assignmentId: z.string(),
  /** Already uploaded through `document.createUploadUrl` on the student's own
   * submissions project — the same two-step every other upload in this
   * codebase uses, so no new storage path is invented here. */
  storagePath: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  note: z.string().max(2000).optional(),
});

/** The caller's own Student record, their enrollment on this assignment's
 * course, and the assignment — or a refusal. This is the whole authorization:
 * you may submit against an assignment iff you are the enrolled student. */
async function resolveOwnEnrollment(tx: PrismaTx, ctx: MutationContext, assignmentId: string) {
  const student = await tx.student.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, deletedAt: null } });
  if (!student) throw new ForbiddenException("Only a student can hand in work, and this login isn't linked to a student record.");

  const assignment = await tx.assignment.findFirst({ where: { id: assignmentId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!assignment) throw new NotFoundException(`No assignment "${assignmentId}"`);

  const enrollment = await tx.enrollment.findFirst({
    where: { tenantId: ctx.tenantId, studentId: student.id, courseId: assignment.courseId },
  });
  // 404, not 403 — being told "that assignment exists, you're just not on the
  // course" is more than a student outside it should learn.
  if (!enrollment) throw new NotFoundException(`No assignment "${assignmentId}"`);
  if (!enrollment.submissionsProjectId) {
    throw new BadRequestException("This enrolment has no submissions folder yet — ask the school office to re-enrol you.");
  }

  return { student, assignment, enrollment, submissionsProjectId: enrollment.submissionsProjectId };
}

/**
 * Ungated ON PURPOSE — declared in `authorization-invariants.spec.ts`.
 *
 * Handing in your own work is ownership, exactly as `task.submitForReview` is:
 * the enrollment check above IS the authorization, and no permission triple
 * could express it (any scope wide enough to let a student submit would let
 * them submit for a classmate). The Student role holds `document:create:own`
 * and owns the submissions project, which is what lets the upload itself
 * through the ordinary document gate.
 */
export const assignmentSubmitMutation: MutationDefinition<z.infer<typeof SubmitInputSchema>> = {
  name: "assignment.submit",
  inputSchema: SubmitInputSchema,
  async resolve(input, ctx, tx) {
    const { student, assignment, submissionsProjectId } = await resolveOwnEnrollment(tx, ctx, input.assignmentId);

    const existingTask = await tx.task.findFirst({
      where: { tenantId: ctx.tenantId, assignmentId: assignment.id, assigneeId: ctx.userId, deletedAt: null },
    });
    if (existingTask?.status === "done") {
      throw new BadRequestException("This work has already been marked complete — ask your teacher to reopen it.");
    }

    // Find-or-create: a resubmission after "changes requested" reuses the same
    // task, so its review history stays in one place rather than fragmenting
    // across a task per attempt.
    const task =
      existingTask ??
      (await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          projectId: submissionsProjectId,
          assignmentId: assignment.id,
          // Named for a person reading a review queue, not for the database.
          title: `${assignment.title} — ${student.name}`,
          assigneeId: ctx.userId,
          status: "todo",
          dueDate: assignment.dueDate,
        },
      }));

    const document = await tx.document.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: submissionsProjectId,
        taskId: task.id,
        name: input.name,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: ctx.userId,
      },
    });
    await tx.documentActivity.create({
      data: { tenantId: ctx.tenantId, documentId: document.id, actorId: ctx.userId, type: "uploaded" },
    });
    await enqueueDocumentEmbeddingJob(tx, ctx.tenantId, document.id, document.mimeType);

    // The same fields `task.submitForReview` writes — this is that step, not a
    // parallel one. Clearing the previous decision matters here more than
    // anywhere: a resubmission must not still show last week's "changes
    // requested".
    const submitted = await tx.task.update({
      where: { id: task.id },
      data: {
        status: "in_review",
        submittedById: ctx.userId,
        submittedAt: new Date(),
        reviewNote: input.note ?? null,
        reviewedById: null,
        reviewedAt: null,
      },
    });

    // The teacher of record is a member of the submissions project, so they
    // already see the task. This is the nudge, not the access.
    const course = await tx.course.findFirst({ where: { id: assignment.courseId, tenantId: ctx.tenantId }, select: { teacherId: true } });
    if (course?.teacherId && course.teacherId !== ctx.userId) {
      await tx.notification.create({
        data: {
          tenantId: ctx.tenantId,
          userId: course.teacherId,
          type: "assignment.submitted",
          title: "Work handed in",
          body: `${student.name} submitted "${assignment.title}"`,
          data: { taskId: submitted.id, projectId: submissionsProjectId, assignmentId: assignment.id },
        },
      });
    }

    return { taskId: submitted.id, documentId: document.id, status: submitted.status, submittedAt: submitted.submittedAt };
  },
};

/** Where the student's own upload URL has to be minted against — the portal
 * has no other way to learn its own submissions project id, and it must not
 * be handed a project id it could then use for anything else. Ungated for the
 * same ownership reason as the mutation above. */
const TargetInputSchema = z.object({ assignmentId: z.string() });

export const assignmentSubmissionTargetMutation: MutationDefinition<z.infer<typeof TargetInputSchema>> = {
  name: "assignment.submissionTarget",
  inputSchema: TargetInputSchema,
  async resolve(input, ctx, tx) {
    const { submissionsProjectId } = await resolveOwnEnrollment(tx, ctx, input.assignmentId);
    return { projectId: submissionsProjectId };
  },
};
