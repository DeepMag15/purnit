import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Healthcare Domain, Phase A. Same `*Where()` contract as `patientsWhere`
 * (`patients.data-sources.ts`) — `Appointment` also has no `departmentId`
 * column, so `own`/`team`/`department`/`department-subtree` all collapse to
 * "my own appointments" (`doctorId = ctx.userId`); only `tenant` scope
 * (Hospital Administrator, Receptionist) sees every appointment. */
export async function appointmentsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("appointment", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, ...extra };
  if (scope === "tenant") return where;
  where.doctorId = ctx.userId;
  return where;
}

const ListParamsSchema = z.object({ patientId: z.string().optional(), status: z.string().optional() });

export const appointmentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "appointments.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "appointment:read",
  async resolve(params, ctx, tx) {
    const extra: Record<string, unknown> = {};
    if (params.patientId) extra.patientId = params.patientId;
    if (params.status) extra.status = params.status;
    const where = await appointmentsWhere(tx, ctx, extra);
    if (!where) return [];

    const appointments = await tx.appointment.findMany({
      where,
      orderBy: { scheduledStart: "asc" },
      take: 100,
      include: { patient: { select: { id: true, name: true } } },
    });
    if (appointments.length === 0) return [];

    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const doctorIds = [...new Set(appointments.map((a) => a.doctorId))];
    const doctors = await tx.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, displayName: true } });
    const doctorNameById = new Map(doctors.map((d) => [d.id, d.displayName]));

    return appointments.map((a) => ({
      id: a.id,
      patientId: a.patientId,
      patientName: a.patient.name,
      doctorId: a.doctorId,
      doctorName: doctorNameById.get(a.doctorId) ?? "Unknown",
      scheduledStart: a.scheduledStart,
      scheduledEnd: a.scheduledEnd,
      status: a.status,
      notes: a.notes,
    }));
  },
};

const AppointmentsCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `AppointmentsWorkspace.tsx`'s move off the
 * generic Renderer loses the `actions` prop its booking/status controls
 * currently check. `appointment.create`/`appointment.updateStatus` declare
 * genuinely different resources (`appointment:create`/`appointment:update`,
 * confirmed directly against each mutation), so both get their own flag —
 * no `requiredPermission` of its own (callable by anyone), same precedent
 * as `analytics.capabilities`. */
export const appointmentsCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof AppointmentsCapabilitiesParamsSchema>> = {
  name: "appointments.capabilities",
  paramsSchema: AppointmentsCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("appointment", "create") !== null,
      canUpdateStatus: ctx.effective.has("appointment", "update") !== null,
    };
  },
};
