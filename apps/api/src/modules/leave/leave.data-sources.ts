import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { Scope } from "@purnit/manifest-schema";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { isRowInScope } from "../../rbac/scope-check";

/** Only resolved when actually needed — see department-subtree.ts. Same
 * local-helper precedent as every other module's own `resolveSubtreeIds`. */
async function resolveSubtreeIds(tx: PrismaTx, ctx: DataSourceContext, scope: Scope | null): Promise<string[] | undefined> {
  return scope === "department-subtree" && ctx.userDepartmentId ? getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
}

/** Same shape as attendance.data-sources.ts's resolveScopedRosterUserIds —
 * which OTHER users' leave the actor's granted scope covers. Returns `null`
 * for `"own"` (no roster). Always includes the actor's own id. */
async function resolveScopedRosterUserIds(tx: PrismaTx, ctx: DataSourceContext, scope: Scope): Promise<string[] | null> {
  if (scope === "own") return null;
  if (scope === "tenant") {
    const users = await tx.user.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, select: { id: true } });
    return users.map((u) => u.id);
  }
  const departmentIds =
    scope === "department-subtree" && ctx.userDepartmentId
      ? await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId)
      : ctx.userDepartmentId
        ? [ctx.userDepartmentId]
        : [];
  if (departmentIds.length === 0) return [ctx.userId];
  const users = await tx.user.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null, departmentId: { in: departmentIds } }, select: { id: true } });
  const ids = new Set(users.map((u) => u.id));
  ids.add(ctx.userId);
  return [...ids];
}

/**
 * AI RAG Phase C — the reusable `xWhere`-style scope function this module
 * never had before (every other module's own data-sources already has
 * one). Reuses the `leave:read` scope path only, the same one
 * `leaveRequestsList` above applies for "someone else's" requests —
 * deliberately NOT unioned with `leaveRequestsPendingApprovals`' separate
 * direct-approver fast path (`approverId === ctx.userId`, regardless of
 * granted scope width). That fast path is about who can *act* on a
 * request, not who can generally *see* it — a different concern than RAG
 * visibility, which is about what an actor can view/cite. A real design
 * decision, not a mechanical extraction.
 */
export async function leaveWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("leave", "read");
  if (!scope) return null;
  if (scope === "own") return { tenantId: ctx.tenantId, userId: ctx.userId, ...extra };
  const userIds = await resolveScopedRosterUserIds(tx, ctx, scope);
  return { tenantId: ctx.tenantId, userId: { in: userIds ?? [ctx.userId] }, ...extra };
}

const CapabilitiesParamsSchema = z.object({});

/** Same `project.detail`-style precedent as `attendance.capabilities` — no
 * `requiredPermission` (callable by anyone), lets LeaveWorkspace.tsx
 * conditionally render/fetch the "Pending Approvals" and "Manage Types"
 * sections without guessing from a role label. */
export const leaveCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof CapabilitiesParamsSchema>> = {
  name: "leave.capabilities",
  paramsSchema: CapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    const approveScope = ctx.effective.has("leave", "approve");
    return {
      canApprove: approveScope !== null,
      canManageTypes: !!ctx.effective.has("leave", "manageTypes"),
    };
  },
};

const TypesListParamsSchema = z.object({});

/** Low-sensitivity metadata (name + default allotment) — no requiredPermission,
 * same "everyone needs to see the picker options" precedent as `roles.list`.
 * Actual per-user requests/balances are the sensitive data, gated below. */
export const leaveTypesListDataSource: DataSourceDefinition<z.infer<typeof TypesListParamsSchema>> = {
  name: "leaveTypes.list",
  paramsSchema: TypesListParamsSchema,
  async resolve(_params, ctx, tx) {
    return tx.leaveType.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, orderBy: { name: "asc" } });
  },
};

const RequestsListParamsSchema = z.object({ userId: z.string().optional() });

/** Two modes, exact same shape as attendance.list: (a) no userId (or
 * userId === ctx.userId) — self history, no scope check needed since
 * leave:read:own is a universal floor. (b) explicit userId for someone
 * else — single-target isRowInScope check, the assertInviteesInScope
 * precedent applied to one known target. */
export const leaveRequestsListDataSource: DataSourceDefinition<z.infer<typeof RequestsListParamsSchema>> = {
  name: "leaveRequests.list",
  paramsSchema: RequestsListParamsSchema,
  requiredPermission: "leave:read",
  async resolve(params, ctx, tx) {
    const { userId } = params;
    const scope = ctx.effective.has("leave", "read");
    if (!scope) throw new ForbiddenException('Missing permission "leave:read"');

    const targetUserId = userId ?? ctx.userId;
    if (targetUserId !== ctx.userId) {
      const target = await tx.user.findFirst({ where: { id: targetUserId, tenantId: ctx.tenantId, deletedAt: null }, select: { id: true, departmentId: true } });
      if (!target) throw new NotFoundException(`No user "${targetUserId}"`);
      const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
      const inScope = isRowInScope(
        scope,
        { ownerId: null, departmentId: target.departmentId },
        { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
      );
      if (!inScope) throw new ForbiddenException("Not allowed to view this user's leave requests");
    }

    return tx.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, userId: targetUserId }, orderBy: { createdAt: "desc" } });
  },
};

const PendingApprovalsParamsSchema = z.object({});

/**
 * Every pending request the actor can act on — the union of two paths,
 * exactly matching leave.mutations.ts's own dual-path authorization:
 * (a) direct-manager fast path — requests where `approverId === ctx.userId`,
 *     always included regardless of granted scope width, since
 *     `leave:approve:own` means "requests where I'm literally approverId,"
 *     not row-ownership (ARCHITECTURE.md §5.2's "own is contextual to the
 *     resource" precedent — same shape as `department:manage:own`).
 * (b) override-visibility path — every pending request whose requester
 *     falls within the actor's broader granted scope (department/subtree/
 *     tenant), regardless of who approverId is. This is what lets a
 *     Department Head act on a report's request even when they aren't the
 *     report's direct manager.
 */
export const leaveRequestsPendingApprovalsDataSource: DataSourceDefinition<z.infer<typeof PendingApprovalsParamsSchema>> = {
  name: "leaveRequests.pendingApprovals",
  paramsSchema: PendingApprovalsParamsSchema,
  requiredPermission: "leave:approve",
  async resolve(_params, ctx, tx) {
    const scope = ctx.effective.has("leave", "approve");
    if (!scope) throw new ForbiddenException('Missing permission "leave:approve"');

    const direct = await tx.leaveRequest.findMany({ where: { tenantId: ctx.tenantId, approverId: ctx.userId, status: "pending" }, select: { id: true } });

    let overrideIds: string[] = [];
    if (scope !== "own") {
      const userIds = await resolveScopedRosterUserIds(tx, ctx, scope);
      if (userIds) {
        const overrideRows = await tx.leaveRequest.findMany({
          where: { tenantId: ctx.tenantId, userId: { in: userIds }, status: "pending" },
          select: { id: true },
        });
        overrideIds = overrideRows.map((r) => r.id);
      }
    }

    const allIds = [...new Set([...direct.map((r) => r.id), ...overrideIds])];
    return tx.leaveRequest.findMany({ where: { id: { in: allIds } }, orderBy: { createdAt: "asc" } });
  },
};

const BalancesListParamsSchema = z.object({ userId: z.string().optional(), year: z.coerce.number().int().optional() });

/** Same self/explicit-target shape as leaveRequests.list. A missing
 * LeaveBalance row (never provisioned yet) is not an error — computed as a
 * default `{allottedDays: type.defaultAnnualDays, usedDays: 0}` on the fly,
 * never written here (data sources are read-only in this codebase; the
 * real row is created lazily inside leave.submit's own transaction). */
export const leaveBalancesListDataSource: DataSourceDefinition<z.infer<typeof BalancesListParamsSchema>> = {
  name: "leaveBalances.list",
  paramsSchema: BalancesListParamsSchema,
  requiredPermission: "leave:read",
  async resolve(params, ctx, tx) {
    const scope = ctx.effective.has("leave", "read");
    if (!scope) throw new ForbiddenException('Missing permission "leave:read"');

    const targetUserId = params.userId ?? ctx.userId;
    if (targetUserId !== ctx.userId) {
      const target = await tx.user.findFirst({ where: { id: targetUserId, tenantId: ctx.tenantId, deletedAt: null }, select: { id: true, departmentId: true } });
      if (!target) throw new NotFoundException(`No user "${targetUserId}"`);
      const departmentSubtreeIds = await resolveSubtreeIds(tx, ctx, scope);
      const inScope = isRowInScope(
        scope,
        { ownerId: null, departmentId: target.departmentId },
        { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
      );
      if (!inScope) throw new ForbiddenException("Not allowed to view this user's leave balance");
    }

    const year = params.year ?? new Date().getUTCFullYear();
    const types = await tx.leaveType.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null } });
    const balances = await tx.leaveBalance.findMany({ where: { tenantId: ctx.tenantId, userId: targetUserId, year } });
    const balanceByType = new Map(balances.map((b) => [b.leaveTypeId, b]));

    return types.map((type) => {
      const existing = balanceByType.get(type.id);
      return {
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        year,
        allottedDays: existing?.allottedDays ?? type.defaultAnnualDays,
        usedDays: existing?.usedDays ?? 0,
      };
    });
  },
};
