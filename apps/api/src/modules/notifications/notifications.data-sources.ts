import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

// Notifications are an inherently own-scoped inbox — every authenticated
// user reads their own rows, regardless of role. Unlike Projects/Tasks,
// there's no `requiredPermission` gate and no `isRowInScope()` call: the
// `userId: ctx.userId` filter *is* the scope, not an approximation of one.

const ListParamsSchema = z.object({ unreadOnly: z.boolean().optional() });

export const notificationsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "notifications.list",
  paramsSchema: ListParamsSchema,
  async resolve(params, ctx, tx) {
    return tx.notification.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, ...(params.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  },
};

const UnreadCountParamsSchema = z.object({});

export const notificationsUnreadCountDataSource: DataSourceDefinition<z.infer<typeof UnreadCountParamsSchema>> = {
  name: "notifications.unreadCount",
  paramsSchema: UnreadCountParamsSchema,
  async resolve(_params, ctx, tx) {
    return tx.notification.count({ where: { tenantId: ctx.tenantId, userId: ctx.userId, readAt: null } });
  },
};
