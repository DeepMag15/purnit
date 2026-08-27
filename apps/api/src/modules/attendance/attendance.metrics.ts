import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { ScalarMetricDefinition, BreakdownMetricDefinition, SnapshotRow, AnalyticsFilters } from "../../metrics/metric-registry.service";
import { resolveScopedRosterUserIds } from "./attendance.data-sources";

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function presentRate(tx: PrismaTx, tenantId: string, userIds: string[], from: Date, to: Date): Promise<number> {
  if (userIds.length === 0) return 0;
  const total = await tx.attendanceRecord.count({ where: { tenantId, userId: { in: userIds }, date: { gte: from, lte: to } } });
  if (total === 0) return 0;
  const present = await tx.attendanceRecord.count({ where: { tenantId, userId: { in: userIds }, date: { gte: from, lte: to }, status: "present" } });
  return Math.round((present / total) * 1000) / 10;
}

/** Resolves the actor's real scope-derived roster, then narrows it further
 * with any filter-supplied departmentId/employeeId — never the other way
 * around, so a filter can only ever shrink the set an actor's own real
 * `attendance:read` scope already permits. */
async function scopedUserIds(ctx: DataSourceContext, tx: PrismaTx, filters?: AnalyticsFilters): Promise<{ scope: string; userIds: string[] } | null> {
  const scope = ctx.effective.has("attendance", "read");
  if (!scope) return null;
  let userIds: string[];
  if (scope === "own") {
    userIds = [ctx.userId];
  } else {
    const ids = await resolveScopedRosterUserIds(tx, ctx, scope);
    userIds = ids ?? [ctx.userId];
  }
  if (filters?.employeeId) {
    userIds = userIds.includes(filters.employeeId) ? [filters.employeeId] : [];
  } else if (filters?.departmentId && userIds.length > 0) {
    const users = await tx.user.findMany({ where: { id: { in: userIds }, departmentId: filters.departmentId }, select: { id: true } });
    userIds = users.map((u) => u.id);
  }
  return { scope, userIds };
}

export const attendanceRateThisMonthMetric: ScalarMetricDefinition = {
  kind: "scalar",
  key: "attendance.rateThisMonth",
  module: "Attendance",
  label: "Attendance Rate (This Month)",
  requiredPermission: "attendance:read",
  format: "percent",
  unit: "%",
  async computeLive(ctx, tx, filters) {
    const resolved = await scopedUserIds(ctx, tx, filters);
    if (!resolved) return 0;
    const now = new Date();
    const to = filters?.to ?? now;
    const from = filters?.from ?? startOfUtcMonth(now);
    return presentRate(tx, ctx.tenantId, resolved.userIds, from, to);
  },
  snapshot: {
    // Tenant-wide row PLUS one row per department, day-granularity — "the
    // whole tenant's (and each department's) attendance rate for today
    // specifically," not month-to-date. The trend sparkline this drives is a
    // day-by-day rate history, distinct from the live value's month-to-date
    // aggregate — both meaningful, deliberately different windows for a
    // headline number vs. a trend line. Reuses the same user.departmentId
    // join attendanceRateByDepartmentMetric.computeLive already does below.
    async computeDaily(tenantId, tx): Promise<SnapshotRow[]> {
      const today = startOfUtcDay(new Date());
      const total = await tx.attendanceRecord.count({ where: { tenantId, date: today } });
      let tenantValue = 0;
      if (total > 0) {
        const present = await tx.attendanceRecord.count({ where: { tenantId, date: today, status: "present" } });
        tenantValue = Math.round((present / total) * 1000) / 10;
      }
      const rows: SnapshotRow[] = [{ departmentId: null, value: tenantValue }];

      if (total > 0) {
        const records = await tx.attendanceRecord.findMany({ where: { tenantId, date: today }, select: { userId: true, status: true } });
        const userIds = [...new Set(records.map((r) => r.userId))];
        const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, departmentId: true } });
        const deptByUser = new Map(users.map((u) => [u.id, u.departmentId]));

        const totals = new Map<string, { total: number; present: number }>();
        for (const r of records) {
          const deptId = deptByUser.get(r.userId);
          if (!deptId) continue;
          const bucket = totals.get(deptId) ?? { total: 0, present: 0 };
          bucket.total += 1;
          if (r.status === "present") bucket.present += 1;
          totals.set(deptId, bucket);
        }
        for (const [deptId, { total: deptTotal, present }] of totals) {
          rows.push({ departmentId: deptId, value: deptTotal > 0 ? Math.round((present / deptTotal) * 1000) / 10 : 0 });
        }
      }
      return rows;
    },
  },
};

export const attendanceRateByDepartmentMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "attendance.rateByDepartment",
  module: "Attendance",
  label: "Attendance Rate by Department",
  requiredPermission: "attendance:read",
  nameKey: "department",
  valueKey: "rate",
  async computeLive(ctx, tx, filters) {
    const resolved = await scopedUserIds(ctx, tx, filters);
    if (!resolved || resolved.userIds.length === 0) return [];

    const now = new Date();
    const to = filters?.to ?? now;
    const from = filters?.from ?? startOfUtcMonth(now);
    // Sequential, never Promise.all — both queries share this resolver's one
    // transactional tx (CONTEXT.md §9's rule; see role-hierarchy.ts's own
    // precedent bug for why).
    const users = await tx.user.findMany({ where: { id: { in: resolved.userIds } }, select: { id: true, departmentId: true } });
    const records = await tx.attendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, userId: { in: resolved.userIds }, date: { gte: from, lte: to } },
      select: { userId: true, status: true },
    });

    const deptByUser = new Map(users.map((u) => [u.id, u.departmentId]));
    const deptIds = [...new Set(users.map((u) => u.departmentId).filter((id): id is string => !!id))];
    const departments = deptIds.length > 0 ? await tx.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [];
    const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

    const totals = new Map<string, { total: number; present: number }>();
    for (const r of records) {
      const deptId = deptByUser.get(r.userId) ?? "unassigned";
      const bucket = totals.get(deptId) ?? { total: 0, present: 0 };
      bucket.total += 1;
      if (r.status === "present") bucket.present += 1;
      totals.set(deptId, bucket);
    }

    return [...totals.entries()].map(([deptId, { total, present }]) => ({
      department: deptId === "unassigned" ? "Unassigned" : (deptNameById.get(deptId) ?? "Unknown"),
      rate: total > 0 ? Math.round((present / total) * 100) : 0,
    }));
  },
};

// Phase C (Visual & Widget-Type Depth) — a 2D breakdown feeding Heatmap
// (rowKey="department", colKey="status"), extending the same scoped-
// roster/department-join pattern attendanceRateByDepartmentMetric already
// uses, grouped by (department, status) instead of collapsed into a single
// present-rate.
export const attendanceStatusByDepartmentMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "attendance.statusByDepartment",
  module: "Attendance",
  label: "Attendance Status by Department",
  requiredPermission: "attendance:read",
  nameKey: "department",
  valueKey: "count",
  async computeLive(ctx, tx, filters) {
    const resolved = await scopedUserIds(ctx, tx, filters);
    if (!resolved || resolved.userIds.length === 0) return [];

    const now = new Date();
    const to = filters?.to ?? now;
    const from = filters?.from ?? startOfUtcMonth(now);
    const users = await tx.user.findMany({ where: { id: { in: resolved.userIds } }, select: { id: true, departmentId: true } });
    const records = await tx.attendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, userId: { in: resolved.userIds }, date: { gte: from, lte: to } },
      select: { userId: true, status: true },
    });

    const deptByUser = new Map(users.map((u) => [u.id, u.departmentId]));
    const deptIds = [...new Set(users.map((u) => u.departmentId).filter((id): id is string => !!id))];
    const departments = deptIds.length > 0 ? await tx.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [];
    const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

    const totals = new Map<string, number>();
    for (const r of records) {
      const deptId = deptByUser.get(r.userId);
      if (!deptId) continue;
      const key = `${deptId}::${r.status}`;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }

    return [...totals.entries()].map(([key, count]) => {
      const [deptId, status] = key.split("::") as [string, string];
      return { department: deptNameById.get(deptId) ?? "Unknown", status, count };
    });
  },
};

// Analytics Phase D (Permission-Controlled Widget Catalog) — deliberately
// does NOT call scopedUserIds/resolveScopedRosterUserIds. Every other
// breakdown metric in this file reuses the caller's own attendance:read
// scope; this one is gated by analytics:departmentPerformance instead, and
// that new permission IS the scope — tenant-wide, every department, by
// design, regardless of what attendance:read scope (if any) the caller also
// holds. Safe specifically because analytics:departmentPerformance is a
// brand-new permission nobody holds by default except Company Admin (see
// permission-catalog.ts/seed.ts) — never apply this "ignore the module's own
// *Where() scope" pattern to a metric gated by an existing, already-relied-
// upon permission.
export const attendanceDepartmentLeaderboardMetric: BreakdownMetricDefinition = {
  kind: "breakdown",
  key: "department.performanceLeaderboard",
  module: "Department Performance",
  label: "Department Performance Leaderboard",
  requiredPermission: "analytics:departmentPerformance",
  nameKey: "department",
  valueKey: "rate",
  async computeLive(ctx, tx) {
    const now = new Date();
    const monthStart = startOfUtcMonth(now);
    const records = await tx.attendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, date: { gte: monthStart, lte: now } },
      select: { userId: true, status: true },
    });
    if (records.length === 0) return [];

    const userIds = [...new Set(records.map((r) => r.userId))];
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, departmentId: true } });
    const deptByUser = new Map(users.map((u) => [u.id, u.departmentId]));
    const deptIds = [...new Set(users.map((u) => u.departmentId).filter((id): id is string => !!id))];
    const departments = deptIds.length > 0 ? await tx.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [];
    const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

    const totals = new Map<string, { total: number; present: number }>();
    for (const r of records) {
      const deptId = deptByUser.get(r.userId);
      if (!deptId) continue;
      const bucket = totals.get(deptId) ?? { total: 0, present: 0 };
      bucket.total += 1;
      if (r.status === "present") bucket.present += 1;
      totals.set(deptId, bucket);
    }

    return [...totals.entries()]
      .map(([deptId, { total, present }]) => ({ department: deptNameById.get(deptId) ?? "Unknown", rate: total > 0 ? Math.round((present / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.rate - a.rate);
  },
};
