import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";

// Ownership (`ctx.userId`) is the only check — same reasoning as
// notification.markRead: a user can only ever heartbeat their own presence,
// nothing to gate beyond "is this you." `presenceStatus` is omit-to-leave-
// unchanged, explicit `null` to clear an override back to purely-derived,
// or "away"/"busy" to set one — a plain tick (no field sent) just bumps
// `lastSeenAt`, the common case every ~30s from `usePresenceHeartbeat`.
const HeartbeatInputSchema = z.object({ presenceStatus: z.enum(["away", "busy"]).nullable().optional() });

export const presenceHeartbeatMutation: MutationDefinition<z.infer<typeof HeartbeatInputSchema>> = {
  name: "presence.heartbeat",
  inputSchema: HeartbeatInputSchema,
  async resolve(input, ctx, tx) {
    return tx.user.update({
      where: { id: ctx.userId },
      data: {
        lastSeenAt: new Date(),
        ...(input.presenceStatus !== undefined ? { presenceStatus: input.presenceStatus } : {}),
      },
      select: { id: true, lastSeenAt: true, presenceStatus: true },
    });
  },
};
