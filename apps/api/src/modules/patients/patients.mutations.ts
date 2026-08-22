import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Shared scope-check for row-level patient mutations — same
 * `requireTaskInScope`/`requireDocumentInScope` shape every module in this
 * codebase already follows. A Patient's "owner" for scope purposes is its
 * assigned doctor (no `departmentId` on Patient at all in Phase A, so no
 * department-subtree resolution is needed here — see `patientsWhere`'s own
 * doc comment). */
async function requirePatientInScope(tx: PrismaTx, ctx: MutationContext, patientId: string) {
  const existing = await tx.patient.findFirst({ where: { id: patientId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No patient "${patientId}"`);

  const scope = ctx.effective.has("patient", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.assignedDoctorId }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this patient");
  return existing;
}

const RegisterInputSchema = z.object({
  name: z.string().min(1),
  dateOfBirth: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  assignedDoctorId: z.string().optional(),
});

/** Creates the Patient row and its backing "chart" Project in one
 * transaction — the Project is internal plumbing only (never surfaced as
 * "Project" anywhere in the Healthcare blueprint's own UI); it's what lets
 * Tasks (care plan items) and Documents (medical records) attach for free,
 * reusing projectsWhere/tasksWhere completely unchanged. If an assigned
 * doctor is given, they're added as a ProjectMember of the chart too, so
 * their own task:read/document:read scope (via project membership, the
 * exact same mechanism `project.addMember` already relies on) naturally
 * covers this patient's chart without a second, healthcare-specific scope
 * mechanism. */
export const patientRegisterMutation: MutationDefinition<z.infer<typeof RegisterInputSchema>> = {
  name: "patient.register",
  inputSchema: RegisterInputSchema,
  requiredPermission: "patient:create",
  async resolve(input, ctx, tx) {
    if (input.assignedDoctorId) {
      const doctor = await tx.user.findFirst({ where: { id: input.assignedDoctorId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!doctor) throw new NotFoundException(`No user "${input.assignedDoctorId}"`);
    }

    const chartProject = await tx.project.create({
      data: { tenantId: ctx.tenantId, name: `Chart: ${input.name}`, status: "active", ownerId: ctx.userId },
    });

    const patient = await tx.patient.create({
      data: {
        tenantId: ctx.tenantId,
        chartProjectId: chartProject.id,
        name: input.name,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail,
        assignedDoctorId: input.assignedDoctorId,
        registeredById: ctx.userId,
      },
    });

    if (input.assignedDoctorId) {
      await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: chartProject.id, userId: input.assignedDoctorId } });
    }

    await enqueueEmbeddingJob(tx, ctx.tenantId, "patient", patient.id); // AI RAG Phase C
    return patient;
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const patientUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "patient.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "patient:update",
  async resolve(input, ctx, tx) {
    const existing = await requirePatientInScope(tx, ctx, input.id);
    const updated = await tx.patient.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "patient", updated.id); // AI RAG Phase C
    return updated;
  },
};

const AssignDoctorInputSchema = z.object({ id: z.string(), doctorId: z.string() });

export const patientAssignDoctorMutation: MutationDefinition<z.infer<typeof AssignDoctorInputSchema>> = {
  name: "patient.assignDoctor",
  inputSchema: AssignDoctorInputSchema,
  requiredPermission: "patient:update",
  async resolve(input, ctx, tx) {
    const existing = await requirePatientInScope(tx, ctx, input.id);
    const doctor = await tx.user.findFirst({ where: { id: input.doctorId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!doctor) throw new NotFoundException(`No user "${input.doctorId}"`);

    const updated = await tx.patient.update({ where: { id: existing.id }, data: { assignedDoctorId: input.doctorId } });

    // Idempotent — same "adding an existing member is a no-op" precedent as
    // project.addMember.
    const existingMember = await tx.projectMember.findFirst({ where: { projectId: existing.chartProjectId, userId: input.doctorId } });
    if (!existingMember) {
      await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: existing.chartProjectId, userId: input.doctorId } });
    }

    return updated;
  },
};
