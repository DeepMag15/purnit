import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { teacherOwnedCourseIds } from "../courses/courses.data-sources";

/** Exported — reused by grades.mutations.ts's own `grade.record`. Unlike
 * `requirePatientInScope`/`requireCourseInScope` (a direct `isRowInScope`
 * call against a row's own owner field), this is a Set-membership check
 * against `teacherOwnedCourseIds`, since Assignment's "owner" is transitive
 * through Course, not a directly-comparable User id on the Assignment row
 * itself. Takes the target permission explicitly (not hardcoded to
 * "assignment") since `grade.record` calls this with `{resource: "grade",
 * action: "create"}` to check ITS OWN permission's scope, not
 * `assignment:read`'s. */
export async function requireAssignmentInScope(
  tx: PrismaTx,
  ctx: MutationContext,
  assignmentId: string,
  permission: { resource: string; action: string },
) {
  const assignment = await tx.assignment.findFirst({ where: { id: assignmentId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!assignment) throw new NotFoundException(`No assignment "${assignmentId}"`);

  const scope = ctx.effective.has(permission.resource, permission.action);
  if (!scope) throw new ForbiddenException(`Not allowed to ${permission.action} this assignment`);
  if (scope === "tenant") return assignment;

  const ownedCourseIds = await teacherOwnedCourseIds(tx, ctx);
  if (!ownedCourseIds.includes(assignment.courseId)) {
    throw new ForbiddenException(`Not allowed to ${permission.action} this assignment`);
  }
  return assignment;
}

const CreateInputSchema = z.object({
  courseId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  maxScore: z.number().int().positive().optional(),
});

/** Explicitly checks `courseId ∈ teacherOwnedCourseIds` when scope isn't
 * `tenant` — a deliberate, disclosed departure from this codebase's normal
 * "creates aren't scope-checked, only permission-gated" convention
 * (`patient.register`/`appointment.create` never call a scope check).
 * Necessary here because, unlike Healthcare (no role is ever granted `:own`
 * on a create permission), Teacher genuinely holds `assignment:create:own` —
 * skipping this would let any Teacher create assignments under any other
 * teacher's course. */
export const assignmentCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "assignment.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "assignment:create",
  async resolve(input, ctx, tx) {
    const course = await tx.course.findFirst({ where: { id: input.courseId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!course) throw new NotFoundException(`No course "${input.courseId}"`);

    const scope = ctx.effective.has("assignment", "create");
    if (scope !== "tenant") {
      const ownedCourseIds = await teacherOwnedCourseIds(tx, ctx);
      if (!ownedCourseIds.includes(course.id)) throw new ForbiddenException("Not allowed to create assignments for this course");
    }

    return tx.assignment.create({
      data: {
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        title: input.title,
        description: input.description,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        maxScore: input.maxScore ?? 100,
        createdById: ctx.userId,
      },
    });
  },
};

const UpdateInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  maxScore: z.number().int().positive().optional(),
});

export const assignmentUpdateMutation: MutationDefinition<z.infer<typeof UpdateInputSchema>> = {
  name: "assignment.update",
  inputSchema: UpdateInputSchema,
  requiredPermission: "assignment:update",
  async resolve(input, ctx, tx) {
    const existing = await requireAssignmentInScope(tx, ctx, input.id, { resource: "assignment", action: "update" });
    return tx.assignment.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        maxScore: input.maxScore,
      },
    });
  },
};
