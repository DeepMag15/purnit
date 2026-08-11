import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { projectsWhere } from "../projects/projects.data-sources";

/** Finance Domain, Phase A. Same `*Where()` contract every module follows.
 * `:own` resolves to `accountManagerId = ctx.userId` — a REAL, non-inert
 * scope (unlike Teacher's own Education-domain precedent): `client:create`
 * is tenant-wide for Sales Rep, so a Sales Rep genuinely owns the clients
 * they create, making `:own` resolve to something real from day one. */
export async function clientsWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("client", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.accountManagerId = ctx.userId;
  return where;
}

/** The ownership (NOT scope) query `invoicesWhere` imports to resolve its
 * own `:own` floor transitively through Client. Deliberately does NOT call
 * `clientsWhere` — mirrors `teacherOwnedCourseIds`'s own doc comment exactly:
 * `clientsWhere` answers "which clients can I *see*" (Sales Rep holds
 * `client:read:tenant`, broad); this answers "which clients do I *own*" (an
 * ownership fact, independent of read-scope). Routing through `clientsWhere`
 * here would silently widen every Sales Rep's Invoice `:own` floor to
 * "every client in the tenant," defeating `:own` scope entirely. */
export async function salesRepOwnedClientIds(tx: PrismaTx, ctx: { tenantId: string; userId: string }, accountManagerId: string = ctx.userId): Promise<string[]> {
  const clients = await tx.client.findMany({
    where: { tenantId: ctx.tenantId, accountManagerId, deletedAt: null },
    select: { id: true },
  });
  return clients.map((c) => c.id);
}

async function withAccountManagerNames(tx: PrismaTx, clients: { accountManagerId: string | null }[]) {
  const managerIds = [...new Set(clients.map((c) => c.accountManagerId).filter((id): id is string => !!id))];
  if (managerIds.length === 0) return new Map<string, string>();
  const managers = await tx.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, displayName: true } });
  return new Map(managers.map((m) => [m.id, m.displayName]));
}

async function withInvoiceCounts(tx: PrismaTx, tenantId: string, clients: { id: string }[]) {
  if (clients.length === 0) return new Map<string, number>();
  const grouped = await tx.invoice.groupBy({
    by: ["clientId"],
    where: { tenantId, deletedAt: null, clientId: { in: clients.map((c) => c.id) } },
    _count: { clientId: true },
  });
  return new Map(grouped.map((g) => [g.clientId, g._count.clientId]));
}

/** `client:read` and `project:read` are different permissions — a Client
 * being visible does NOT mean its Files Project's Documents/Comments are.
 * Reuses `projectsWhere` unchanged, same technique `patients.data-sources.ts`'s
 * `withChartVisibility`/Education's `materialsVisible` already established —
 * built in from Phase A here, not retrofitted after a live bug report. */
async function filesVisible(tx: PrismaTx, ctx: DataSourceContext, filesProjectId: string): Promise<boolean> {
  const where = await projectsWhere(tx, ctx, { id: filesProjectId });
  if (!where) return false;
  const project = await tx.project.findFirst({ where });
  return !!project;
}

const ListParamsSchema = z.object({ status: z.string().optional() });

export const clientsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "clients.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "client:read",
  async resolve(params, ctx, tx) {
    const where = await clientsWhere(tx, ctx, params.status ? { status: params.status } : {});
    if (!where) return [];
    const clients = await tx.client.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const managerNames = await withAccountManagerNames(tx, clients);
    const invoiceCounts = await withInvoiceCounts(tx, ctx.tenantId, clients);
    return clients.map((c) => ({
      ...c,
      accountManagerName: c.accountManagerId ? (managerNames.get(c.accountManagerId) ?? null) : null,
      invoiceCount: invoiceCounts.get(c.id) ?? 0,
    }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

export const clientDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "clients.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await clientsWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No client "${params.id}"`);
    const client = await tx.client.findFirst({ where });
    if (!client) throw new NotFoundException(`No client "${params.id}"`);

    const managerNames = await withAccountManagerNames(tx, [client]);
    const invoiceCount = await tx.invoice.count({ where: { tenantId: ctx.tenantId, clientId: client.id, deletedAt: null } });

    const canUpdate = !!ctx.effective.has("client", "update");
    const canReadInvoices = !!ctx.effective.has("invoice", "read");
    const canCreateDocuments = !!ctx.effective.has("document", "create");
    const canUpdateDocuments = !!ctx.effective.has("document", "update");
    const canDeleteDocuments = !!ctx.effective.has("document", "delete");
    const filesAreVisible = await filesVisible(tx, ctx, client.filesProjectId);

    return {
      ...client,
      accountManagerName: client.accountManagerId ? (managerNames.get(client.accountManagerId) ?? null) : null,
      invoiceCount,
      canUpdate,
      canReadInvoices,
      canCreateDocuments,
      canUpdateDocuments,
      canDeleteDocuments,
      filesVisible: filesAreVisible,
    };
  },
};

const AccountManagerOptionsParamsSchema = z.object({});

/** Mirrors `coursesTeacherOptionsDataSource` exactly — `RoleAssignment` has
 * no Prisma relation to `User` (same no-FK, app-layer convention used
 * everywhere else), so this is the standard two-query join. */
export const clientsAccountManagerOptionsDataSource: DataSourceDefinition<z.infer<typeof AccountManagerOptionsParamsSchema>> = {
  name: "clients.accountManagerOptions",
  paramsSchema: AccountManagerOptionsParamsSchema,
  requiredPermission: "client:read",
  async resolve(_params, ctx, tx) {
    const assignments = await tx.roleAssignment.findMany({
      where: { tenantId: ctx.tenantId, role: { sourceBlueprintRoleId: "role.sales-rep" } },
      select: { userId: true },
    });
    if (assignments.length === 0) return [];
    const userIds = [...new Set(assignments.map((a) => a.userId))];
    return tx.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, displayName: true } });
  },
};
