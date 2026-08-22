import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

// Derivation thresholds, per the approved plan: an explicit `presenceStatus`
// override always wins (a user who sets "away"/"busy" stays that way
// regardless of how recently they heartbeat); absent an override, status is
// purely a function of how long ago `lastSeenAt` was bumped.
const ONLINE_WITHIN_MS = 2 * 60_000;
const AWAY_WITHIN_MS = 10 * 60_000;

function deriveStatus(user: { lastSeenAt: Date | null; presenceStatus: string | null }): string {
  if (user.presenceStatus) return user.presenceStatus;
  if (!user.lastSeenAt) return "offline";
  const idleMs = Date.now() - user.lastSeenAt.getTime();
  if (idleMs <= ONLINE_WITHIN_MS) return "online";
  if (idleMs <= AWAY_WITHIN_MS) return "away";
  return "offline";
}

// No requiredPermission, deliberately — presence status is far lower-
// sensitivity than the full roster `users.list` returns (email, roles,
// department, gated on user:manage) and is only ever useful alongside a UI
// that already displays these same people's names (team rosters, DM lists),
// so gating it further would just break those UIs for everyone below
// user:manage. Tenant boundary (`tenantId: ctx.tenantId`) is the only scope
// — same "ownership/tenancy is the whole scope" treatment as
// notifications.list. Bounded at 100 ids per call — every real consumer
// (PresenceDot) only ever asks for the userIds actually on screen at once,
// never a whole tenant.
const ListParamsSchema = z.object({ userIds: z.array(z.string()).min(1).max(100) });

export const presenceListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "presence.list",
  paramsSchema: ListParamsSchema,
  async resolve(params, ctx, tx) {
    const users = await tx.user.findMany({
      where: { id: { in: params.userIds }, tenantId: ctx.tenantId },
      select: { id: true, lastSeenAt: true, presenceStatus: true },
    });
    return users.map((u) => ({ userId: u.id, status: deriveStatus(u) }));
  },
};
