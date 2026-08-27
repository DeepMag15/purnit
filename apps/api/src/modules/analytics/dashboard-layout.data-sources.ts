import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { WidgetLayoutEntry } from "./dashboard-layout.types";

const GetParamsSchema = z.object({ dashboardKey: z.string() });

/**
 * Platform UI/UX Redesign, Phase F — extracted verbatim from
 * `analytics.dashboard`'s own inline layout-resolution block
 * (analytics.data-sources.ts), parameterized by `dashboardKey` instead of
 * hardcoded to `"analytics"`. `analytics.dashboard` itself is deliberately
 * left calling its own inline copy rather than this data source, to avoid
 * touching already-shipped Analytics code in this phase — a real, disclosed
 * scope boundary, not an oversight.
 *
 * No `requiredPermission` — same reasoning `analytics.dashboard` already
 * uses: a layout only ever reorders/positions widgets the caller already
 * independently has access to via their own `bind`, never widens
 * visibility. Personal layout takes priority over the role-level template
 * when both exist; sequential queries against this resolver's one shared
 * `tx`, never `Promise.all`.
 */
export const dashboardLayoutGetDataSource: DataSourceDefinition<z.infer<typeof GetParamsSchema>> = {
  name: "dashboardLayout.get",
  paramsSchema: GetParamsSchema,
  async resolve({ dashboardKey }, ctx, tx) {
    const personal = await tx.dashboardLayout.findFirst({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, dashboardKey, isActive: true },
      select: { widgets: true },
    });
    let layoutRow = personal;
    if (!layoutRow) {
      const roleAssignment = await tx.roleAssignment.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { roleId: true } });
      layoutRow = roleAssignment
        ? await tx.dashboardLayout.findFirst({
            where: { tenantId: ctx.tenantId, roleId: roleAssignment.roleId, userId: null, dashboardKey, isActive: true },
            select: { widgets: true },
          })
        : null;
    }
    return { layout: (layoutRow?.widgets as WidgetLayoutEntry[] | undefined) ?? undefined };
  },
};
