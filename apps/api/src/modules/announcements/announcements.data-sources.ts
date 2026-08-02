import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentAncestorIds } from "../../rbac/department-ancestors";

/**
 * No RBAC scope-widening (unlike meetingsWhere) — visibility is purely
 * structural: everyone always sees tenant-wide posts (`departmentId` null)
 * plus posts targeting their own department or any ancestor of it (an
 * announcement targeting department D cascades down to D's descendants, so
 * a reader whose own department is a descendant of D always has D in their
 * own ancestor chain). A user with no department (`ctx.userDepartmentId`
 * null) sees only tenant-wide posts. Never returns `null` — every tenant
 * member can call this, same "ungated data source + row-level where clause"
 * shape as `meetingsWhere`.
 */
export async function announcementsWhere(tx: PrismaTx, ctx: DataSourceContext): Promise<Record<string, unknown>> {
  const ancestorIds = ctx.userDepartmentId ? await getDepartmentAncestorIds(tx, ctx.tenantId, ctx.userDepartmentId) : [];
  return {
    tenantId: ctx.tenantId,
    deletedAt: null,
    OR: [{ departmentId: null }, ...(ancestorIds.length > 0 ? [{ departmentId: { in: ancestorIds } }] : [])],
  };
}

async function withAuthorNames(tx: PrismaTx, announcements: { authorId: string }[]) {
  const authorIds = [...new Set(announcements.map((a) => a.authorId))];
  if (authorIds.length === 0) return new Map<string, string>();
  const authors = await tx.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true } });
  return new Map(authors.map((a) => [a.id, a.displayName]));
}

async function withDepartmentNames(tx: PrismaTx, announcements: { departmentId: string | null }[]) {
  const departmentIds = [...new Set(announcements.map((a) => a.departmentId).filter((id): id is string => id != null))];
  if (departmentIds.length === 0) return new Map<string, string>();
  const departments = await tx.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } });
  return new Map(departments.map((d) => [d.id, d.name]));
}

const ListParamsSchema = z.object({});

// No requiredPermission — see announcementsWhere's doc comment.
export const announcementsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "announcements.list",
  paramsSchema: ListParamsSchema,
  async resolve(_params, ctx, tx) {
    const where = await announcementsWhere(tx, ctx);
    const announcements = await tx.announcement.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });

    // Sequential, not Promise.all — concurrent queries against the same
    // transactional `tx` are unsafe (CONTEXT.md §9).
    const authorNames = await withAuthorNames(tx, announcements);
    const departmentNames = await withDepartmentNames(tx, announcements);

    return announcements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      authorId: a.authorId,
      authorName: authorNames.get(a.authorId) ?? null,
      departmentId: a.departmentId,
      departmentName: a.departmentId ? (departmentNames.get(a.departmentId) ?? null) : null,
      createdAt: a.createdAt,
    }));
  },
};
