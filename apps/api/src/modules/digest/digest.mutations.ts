import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";

// Ownership (`ctx.userId`) is the only check — same reasoning as
// presence.heartbeat/notification.markRead: a user can only ever set their
// own digest preference, nothing to gate beyond "is this you."
const UpdateDigestPreferenceInputSchema = z.object({ optOut: z.boolean() });

export const userUpdateDigestPreferenceMutation: MutationDefinition<z.infer<typeof UpdateDigestPreferenceInputSchema>> = {
  name: "user.updateDigestPreference",
  inputSchema: UpdateDigestPreferenceInputSchema,
  async resolve(input, ctx, tx) {
    return tx.user.update({ where: { id: ctx.userId }, data: { digestOptOut: input.optOut }, select: { id: true, digestOptOut: true } });
  },
};
