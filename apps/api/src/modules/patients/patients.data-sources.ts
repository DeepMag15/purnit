import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Healthcare Domain, Phase A. Same `*Where()` contract every module in this
 * codebase already follows — never a parallel/reimplemented scope check.
 * `own`/`team`/`department`/`department-subtree` all collapse to the same
 * "my assigned patients only" floor: `Patient` has no `departmentId` column
 * at all (Phase A ships no Healthcare department taxonomy, see the Phase A
 * plan's own §6.3 disclosed MVP narrowing), so there's no wider-than-own
 * dimension for those scopes to actually widen through — a disclosed
 * simplification, not a bug. Only `tenant` scope sees every patient. */
export async function patientsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("patient", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.assignedDoctorId = ctx.userId;
  return where;
}

async function withDoctorNames(tx: PrismaTx, patients: { assignedDoctorId: string | null }[]) {
  const doctorIds = [...new Set(patients.map((p) => p.assignedDoctorId).filter((id): id is string => !!id))];
  if (doctorIds.length === 0) return new Map<string, string>();
  const doctors = await tx.user.findMany({ where: { id: { in: doctorIds } }, select: { id: true, displayName: true } });
  return new Map(doctors.map((d) => [d.id, d.displayName]));
}

const DoctorOptionsParamsSchema = z.object({});

/** A lightweight "who can I assign/book this patient to" picker — gated on
 * `patient:read` since every Healthcare role that ever needs to pick a
 * doctor (Doctor, Nurse, Receptionist, Hospital Administrator) already
 * holds it at tenant scope by default. `RoleAssignment` has no Prisma
 * relation to `User` (same no-FK, app-layer convention used everywhere else
 * in this codebase), so this is the standard two-query join, not a single
 * `include`. */
export const patientsDoctorOptionsDataSource: DataSourceDefinition<z.infer<typeof DoctorOptionsParamsSchema>> = {
  name: "patients.doctorOptions",
  paramsSchema: DoctorOptionsParamsSchema,
  requiredPermission: "patient:read",
  async resolve(_params, ctx, tx) {
    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId: ctx.tenantId, role: { sourceBlueprintRoleId: "role.doctor" } },
      select: { userId: true },
    });
    if (assignments.length === 0) return [];
    const userIds = [...new Set(assignments.map((a) => a.userId))];
    return tx.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, displayName: true } });
  },
};

const ListParamsSchema = z.object({ status: z.string().optional() });

export const patientsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "patients.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "patient:read",
  async resolve(params, ctx, tx) {
    const where = await patientsWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return [];
    // Phase 1-style capped result set, no real cursor pagination yet — same
    // simplification as projects.list/tasks.list.
    const patients = await tx.patient.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const doctorNames = await withDoctorNames(tx, patients);
    return patients.map((p) => ({
      ...p,
      assignedDoctorName: p.assignedDoctorId ? (doctorNames.get(p.assignedDoctorId) ?? null) : null,
    }));
  },
};
