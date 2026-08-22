import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

// Notifications are an inherently own-scoped inbox — every authenticated
// user reads their own rows, regardless of role. Unlike Projects/Tasks,
// there's no `requiredPermission` gate and no `isRowInScope()` call: the
// `userId: ctx.userId` filter *is* the scope, not an approximation of one.

// The first genuinely server-paginated data source in this codebase — every
// other list (Table3's own `pageSize`, `usePagination`) paginates an
// already-fully-fetched local array. `page` is 0-indexed and `take` is a
// fixed server-side page size (not client-controlled), so a caller can't
// request an unbounded page. `page` defaults to 0 and PAGE_SIZE matches the
// bell dropdown's original `take: 20` exactly — the bell's own
// `notifications.list({})` call is unchanged by this.
const PAGE_SIZE = 20;

const ListParamsSchema = z.object({
  unreadOnly: z.boolean().optional(),
  type: z.string().optional(),
  page: z.number().int().min(0).optional(),
});

export const notificationsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "notifications.list",
  paramsSchema: ListParamsSchema,
  async resolve(params, ctx, tx) {
    return tx.notification.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        ...(params.unreadOnly ? { readAt: null } : {}),
        ...(params.type ? { type: params.type } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (params.page ?? 0) * PAGE_SIZE,
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
