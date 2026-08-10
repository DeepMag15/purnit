import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { isRowInScope } from "../../rbac/scope-check";

const CreateInputSchema = z.object({
  patientId: z.string(),
  doctorId: z.string(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  notes: z.string().optional(),
});

/** No conflict/double-booking detection in Phase A — a real, disclosed MVP
 * narrowing, not an oversight; revisit if actually needed once this ships. */
export const appointmentCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "appointment.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "appointment:create",
  async resolve(input, ctx, tx) {
    const patient = await tx.patient.findFirst({ where: { id: input.patientId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!patient) throw new NotFoundException(`No patient "${input.patientId}"`);
    const doctor = await tx.user.findFirst({ where: { id: input.doctorId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!doctor) throw new NotFoundException(`No user "${input.doctorId}"`);

    return tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        scheduledStart: new Date(input.scheduledStart),
        scheduledEnd: new Date(input.scheduledEnd),
        notes: input.notes,
        bookedById: ctx.userId,
      },
    });
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const appointmentUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "appointment.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "appointment:update",
  async resolve(input, ctx, tx) {
    const existing = await tx.appointment.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
    if (!existing) throw new NotFoundException(`No appointment "${input.id}"`);

    const scope = ctx.effective.has("appointment", "update");
    const inScope = scope && isRowInScope(scope, { ownerId: existing.doctorId }, { userId: ctx.userId });
    if (!inScope) throw new ForbiddenException("Not allowed to update this appointment");

    return tx.appointment.update({ where: { id: existing.id }, data: { status: input.status } });
  },
};
