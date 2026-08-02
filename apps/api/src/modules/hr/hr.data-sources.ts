import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";

/** `department:manage`'s row-level narrowing — "own"/"department" both mean
 * "just my own department" (Department Head); "department-subtree" means my
 * department plus its descendants (Executive); "tenant" is unscoped
 * (Company Admin / HR-flavored Manager tier). Previously this data source
 * was unconditionally tenant-wide regardless of scope — a real, previously
 * undocumented gap closed alongside the Executive tier's introduction. */
async function scopedDepartmentIds(tx: PrismaTx, ctx: DataSourceContext): Promise<string[] | null> {
  const scope = ctx.effective.has("department", "manage");
  if (scope === "tenant") return null; // null = unscoped, see callers
  if (scope === "department-subtree") {
    return ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : [];
  }
  // "own" / "department" (and anything else truthy, defensively)
  return ctx.userDepartmentId ? [ctx.userDepartmentId] : [];
}

const ListDepartmentsParamsSchema = z.object({ includeArchived: z.boolean().optional() });

export const departmentsListDataSource: DataSourceDefinition<z.infer<typeof ListDepartmentsParamsSchema>> = {
  name: "departments.list",
  paramsSchema: ListDepartmentsParamsSchema,
  requiredPermission: "department:manage",
  async resolve(params, ctx, tx) {
    const scopedIds = await scopedDepartmentIds(tx, ctx);
    const where = {
      tenantId: ctx.tenantId,
      ...(scopedIds === null ? {} : { id: { in: scopedIds } }),
      ...(params.includeArchived ? {} : { archivedAt: null }),
    };
    const departments = await tx.department.findMany({ where, orderBy: { createdAt: "asc" } });
    const byId = new Map(departments.map((d) => [d.id, d.name]));
    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      parentId: d.parentId,
      parentName: d.parentId ? (byId.get(d.parentId) ?? null) : null,
      archived: d.archivedAt !== null,
    }));
  },
};

const ListTeamsParamsSchema = z.object({ includeArchived: z.boolean().optional() });

export const teamsListDataSource: DataSourceDefinition<z.infer<typeof ListTeamsParamsSchema>> = {
  name: "teams.list",
  paramsSchema: ListTeamsParamsSchema,
  requiredPermission: "department:manage",
  async resolve(params, ctx, tx) {
    const scopedIds = await scopedDepartmentIds(tx, ctx);
    const where = {
      tenantId: ctx.tenantId,
      ...(scopedIds === null ? {} : { departmentId: { in: scopedIds } }),
      ...(params.includeArchived ? {} : { archivedAt: null }),
    };
    const teams = await tx.team.findMany({ where, include: { department: true }, orderBy: { createdAt: "asc" } });
    // A team under an archived department shouldn't appear as pickable
    // either, by default — even if the team row itself isn't archived, a
    // department you've hidden from active use shouldn't surface teams
    // under it as live destinations.
    const visible = params.includeArchived ? teams : teams.filter((t) => t.department.archivedAt === null);
    return visible.map((t) => ({
      id: t.id,
      name: t.name,
      departmentId: t.departmentId,
      departmentName: t.department.name,
      archived: t.archivedAt !== null,
    }));
  },
};

const ListDepartmentTypesParamsSchema = z.object({});

/** Tenant-wide, unscoped reference data (the known department types this
 * tenant's blueprint defines) — same reasoning as `roles.list`: the catalog
 * itself isn't something "own" narrows, only which departments a caller can
 * act on. Feeds the department-creation type picker in `OrgStructure.tsx`. */
export const departmentTypesListDataSource: DataSourceDefinition<z.infer<typeof ListDepartmentTypesParamsSchema>> = {
  name: "departmentTypes.list",
  paramsSchema: ListDepartmentTypesParamsSchema,
  requiredPermission: "department:manage",
  async resolve(_params, ctx, tx) {
    const rows = await tx.departmentTypeRoleLabel.findMany({ where: { tenantId: ctx.tenantId }, select: { departmentType: true }, distinct: ["departmentType"] });
    return rows.map((r) => ({ id: r.departmentType }));
  },
};
