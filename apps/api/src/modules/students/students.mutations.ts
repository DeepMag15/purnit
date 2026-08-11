import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";

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
    return tx.student.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        registeredById: ctx.userId,
      },
    });
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const studentUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "student.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "student:update",
  async resolve(input, ctx, tx) {
    const existing = await requireStudentInScope(tx, ctx, input.id);
    return tx.student.update({ where: { id: existing.id }, data: { status: input.status } });
  },
};
