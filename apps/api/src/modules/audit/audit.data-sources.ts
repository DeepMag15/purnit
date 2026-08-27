import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

// Same server-side, fixed-page-size pagination shape `notifications.list`
// established first (the codebase's first genuinely server-paginated data
// source) — `page` is 0-indexed, `take` is fixed server-side, not
// client-controlled.
const PAGE_SIZE = 30;

const ListParamsSchema = z.object({
  page: z.number().int().min(0).optional(),
  resource: z.string().optional(),
  action: z.string().optional(),
  actorUserId: z.string().optional(),
});

export const auditLogsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "auditLogs.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "audit:read",
  async resolve(params, ctx, tx) {
    const rows = await tx.auditLog.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(params.resource ? { resource: params.resource } : {}),
        ...(params.action ? { action: params.action } : {}),
        ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (params.page ?? 0) * PAGE_SIZE,
    });

    // Sequential, not Promise.all — one reserved connection per transaction,
    // same discipline as users.data-sources.ts's own comment on this.
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((id): id is string => !!id))];
    const actors = actorIds.length > 0 ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } }) : [];
    const actorNameById = new Map(actors.map((a) => [a.id, a.displayName]));

    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      // A null actorUserId has no real producer today (every logAudit call
      // site passes ctx.userId, always a real authenticated actor) — kept
      // as a genuine possibility anyway since the schema allows it and a
      // future system-initiated entry (a scheduled job, say) shouldn't need
      // a schema change to be representable.
      actorName: r.actorUserId ? (actorNameById.get(r.actorUserId) ?? "Deleted user") : "System",
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt,
    }));
  },
};
