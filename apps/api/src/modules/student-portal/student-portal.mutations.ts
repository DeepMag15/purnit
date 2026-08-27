import { z } from "zod";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { logAudit } from "../../audit/log-audit";

/**
 * Student Role — binding a login to a student record.
 *
 * Deliberately its own mutation rather than a flag on `user.invite`: the two
 * halves genuinely happen at different times and by different people. A
 * Registrar registers students in bulk long before anyone issues portal
 * logins, and a school that never opens a portal must keep working exactly as
 * it does today. Folding this into invite would have forced every caller to
 * think about students.
 *
 * Gated on `student:update` — deciding which login represents which student is
 * a registrar's authority over the student record, not a user-management act.
 * It is the same permission that already governs changing a student's status.
 */
const LinkLoginInputSchema = z.object({
  studentId: z.string(),
  /** Null unlinks — a student who leaves, or a login issued to the wrong record. */
  userId: z.string().nullable(),
});

export const studentLinkLoginMutation: MutationDefinition<z.infer<typeof LinkLoginInputSchema>> = {
  name: "student.linkLogin",
  inputSchema: LinkLoginInputSchema,
  requiredPermission: "student:update",
  async resolve(input, ctx, tx) {
    const student = await tx.student.findFirst({
      where: { id: input.studentId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException(`No student "${input.studentId}"`);

    if (input.userId === null) {
      const cleared = await tx.student.update({ where: { id: student.id }, data: { userId: null } });
      await logAudit(tx, ctx, { action: "student.unlinkLogin", resource: "student", resourceId: student.id });
      return cleared;
    }

    // Sequential, not Promise.all — same shared-tx rule as every other
    // multi-query resolver in this codebase (CONTEXT.md §9).
    const user = await tx.user.findFirst({
      where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null },
    });
    // Same tenant check as every other cross-entity mutation: an id from
    // another workspace must look identical to one that does not exist.
    if (!user) throw new NotFoundException(`No user "${input.userId}"`);

    // `Student.userId` is unique, so the database would reject this anyway —
    // but a raw constraint violation surfaces as a 500 and tells the registrar
    // nothing about which record already holds the login.
    const taken = await tx.student.findFirst({
      where: { tenantId: ctx.tenantId, userId: input.userId, deletedAt: null, NOT: { id: student.id } },
    });
    if (taken) {
      throw new BadRequestException(`That login is already linked to ${taken.name}. Unlink it there first.`);
    }

    const linked = await tx.student.update({ where: { id: student.id }, data: { userId: input.userId } });

    // Backfill materials access for courses they were already enrolled in.
    // Enrolment adds the ProjectMember row, but a student enrolled *before*
    // their login existed had no User to add at the time — without this they
    // would open a course and find no materials, with nothing to explain why.
    const enrolments = await tx.enrollment.findMany({
      where: { tenantId: ctx.tenantId, studentId: student.id, status: { in: ["enrolled", "completed"] } },
      select: { courseId: true, submissionsProjectId: true },
    });

    // Contextual Reporting — a submissions project created before this student
    // had a login is owned by whoever enrolled them. Ownership is what lets a
    // student reach their own submissions (`projectsWhere` at `own` scope
    // filters on ownerId), so hand them over now or the student would find
    // their own submission folder unreachable.
    const orphanedSubmissions = enrolments.map((e) => e.submissionsProjectId).filter((id): id is string => !!id);
    if (orphanedSubmissions.length > 0) {
      await tx.project.updateMany({
        where: { id: { in: orphanedSubmissions }, tenantId: ctx.tenantId },
        data: { ownerId: input.userId },
      });
    }
    if (enrolments.length > 0) {
      const courses = await tx.course.findMany({
        where: { id: { in: enrolments.map((e) => e.courseId) }, tenantId: ctx.tenantId, deletedAt: null },
        select: { materialsProjectId: true },
      });
      const existing = await tx.projectMember.findMany({
        where: { userId: input.userId, projectId: { in: courses.map((c) => c.materialsProjectId) } },
        select: { projectId: true },
      });
      const have = new Set(existing.map((m) => m.projectId));
      for (const course of courses) {
        if (have.has(course.materialsProjectId)) continue;
        await tx.projectMember.create({
          data: { tenantId: ctx.tenantId, projectId: course.materialsProjectId, userId: input.userId },
        });
      }
    }

    await logAudit(tx, ctx, { action: "student.linkLogin", resource: "student", resourceId: student.id });
    return linked;
  },
};
