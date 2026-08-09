import { z } from "zod";
import { ForbiddenException } from "@nestjs/common";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import { isPermissionGranted } from "../../rbac/permission-gate";
import type { MetricRegistry, AnalyticsFilters } from "../../metrics/metric-registry.service";
import type { WidgetLayoutEntry } from "./dashboard-layout.types";

const FiltersParamsSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  employeeId: z.string().optional(),
});

/** Resolves how far back a caller's own scope permits real snapshot-backed
 * trend history: `null` at tenant scope (the snapshot's own tenant-wide
 * row), the caller's own department at department scope, `undefined` for
 * every other scope ("own"/"team"/"department-subtree") — trend history for
 * those is a real, disclosed gap (see Phase B plan §B.1: a department-
 * subtree spans multiple departments, and correctly aggregating a
 * percentage metric across them needs raw numerator/denominator counts the
 * snapshot schema doesn't store yet). Those viewers still get a correct
 * LIVE `value`, just no `trend`. */
function resolveTrendDepartmentId(scope: string, ctx: { userDepartmentId: string | null }): string | null | undefined {
  if (scope === "tenant") return null;
  // A department-scope viewer with no department set (shouldn't happen in
  // practice) falls through to "no trend," not the tenant-wide row — never
  // silently substitute a wider bucket than the viewer's own scope covers.
  if (scope === "department") return ctx.userDepartmentId ?? undefined;
  return undefined;
}

// Factory function, not a plain constant — DataSourceDefinition has no
// constructor injection point, same precedent as
// createUsersEffectivePermissionsDataSource (roles.data-sources.ts).
export function createAnalyticsDashboardDataSource(metricRegistry: MetricRegistry): DataSourceDefinition<z.infer<typeof FiltersParamsSchema>> {
  return {
    name: "analytics.dashboard",
    // Every field optional — an empty-object call behaves identically to
    // Phase A, backward-compatible.
    paramsSchema: FiltersParamsSchema,
    // No requiredPermission — ungated aggregator, same shape as
    // calendar.list; each metric enforces its own visibility below (widget-
    // level pruning is genuinely new territory here — see permission-gate.ts).
    async resolve(params, ctx, tx) {
      const filters: AnalyticsFilters = params;
      const widgets: Record<string, unknown>[] = [];
      // Sequential, never Promise.all — same shared-tx discipline as
      // calendar.list (CONTEXT.md §9).
      for (const metric of metricRegistry.list()) {
        if (!isPermissionGranted(metric.requiredPermission, ctx.effective)) continue;

        if (metric.kind === "scalar") {
          const value = await metric.computeLive(ctx, tx, filters);
          let trend: number[] | undefined;
          if (metric.snapshot && metric.requiredPermission) {
            const [resource, action] = metric.requiredPermission.split(":");
            const scope = ctx.effective.has(resource!, action!);
            const trendDepartmentId = scope ? resolveTrendDepartmentId(scope, ctx) : undefined;
            if (trendDepartmentId !== undefined) {
              const rows = await tx.analyticsSnapshot.findMany({
                where: { tenantId: ctx.tenantId, metricKey: metric.key, departmentId: trendDepartmentId },
                orderBy: { periodStart: "asc" },
                take: 30,
              });
              trend = rows.map((r) => r.value);
            }
          }
          widgets.push({
            kind: "scalar",
            key: metric.key,
            module: metric.module,
            label: metric.label,
            format: metric.format,
            unit: metric.unit,
            value,
            trend,
            drillDown: metric.drillDown,
          });
        } else {
          const rows = await metric.computeLive(ctx, tx, filters);
          widgets.push({ kind: "breakdown", key: metric.key, module: metric.module, label: metric.label, nameKey: metric.nameKey, valueKey: metric.valueKey, rows });
        }
      }

      // Analytics Phase E — an optional saved layout, additive to the
      // response. Absent for any tenant provisioned before this phase, or
      // for a viewer with neither a personal layout nor a role template (no
      // backfill — a missing row is a low-stakes cosmetic fallback to the
      // frontend's own auto-computed arrangement, not a correctness issue).
      // Never widens what's visible: `layout` only ever reorders/positions
      // widgets already present in `widgets` above, which is itself already
      // fully permission-pruned by the loop that just ran. Personal layout
      // takes priority over the role-level template when both exist —
      // sequential, never Promise.all, against this resolver's one shared tx.
      const personal = await tx.dashboardLayout.findFirst({
        where: { tenantId: ctx.tenantId, userId: ctx.userId, dashboardKey: "analytics", isActive: true },
        select: { widgets: true },
      });
      let layoutRow = personal;
      if (!layoutRow) {
        const roleAssignment = await tx.roleAssignment.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { roleId: true } });
        layoutRow = roleAssignment
          ? await tx.dashboardLayout.findFirst({
              where: { tenantId: ctx.tenantId, roleId: roleAssignment.roleId, userId: null, dashboardKey: "analytics", isActive: true },
              select: { widgets: true },
            })
          : null;
      }

      return { widgets, layout: (layoutRow?.widgets as WidgetLayoutEntry[] | undefined) ?? undefined };
    },
  };
}

const TrendParamsSchema = z.object({ metricKey: z.string(), days: z.coerce.number().int().min(1).max(365).default(90) });

export function createAnalyticsTrendDataSource(metricRegistry: MetricRegistry): DataSourceDefinition<z.infer<typeof TrendParamsSchema>> {
  return {
    name: "analytics.trend",
    paramsSchema: TrendParamsSchema,
    async resolve({ metricKey, days }, ctx, tx) {
      const metric = metricRegistry.get(metricKey);
      if (!metric || metric.kind !== "scalar" || !metric.snapshot) return [];
      if (!isPermissionGranted(metric.requiredPermission, ctx.effective)) {
        throw new ForbiddenException(`Missing permission for metric "${metricKey}"`);
      }
      const [resource, action] = (metric.requiredPermission ?? ":").split(":");
      const scope = metric.requiredPermission ? ctx.effective.has(resource!, action!) : "tenant";
      const trendDepartmentId = scope ? resolveTrendDepartmentId(scope, ctx) : undefined;
      if (trendDepartmentId === undefined) {
        throw new ForbiddenException("Trend history is not yet available at your scope");
      }
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const rows = await tx.analyticsSnapshot.findMany({
        where: { tenantId: ctx.tenantId, metricKey, departmentId: trendDepartmentId, periodStart: { gte: since } },
        orderBy: { periodStart: "asc" },
      });
      return rows.map((r) => ({ periodStart: r.periodStart, value: r.value }));
    },
  };
}
