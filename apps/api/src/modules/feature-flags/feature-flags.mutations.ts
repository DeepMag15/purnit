import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";

// Same lowercase-hyphenated shape every real moduleKey in this codebase
// already uses ("leave", "crm", "inventory-items") — not enforced because a
// flag *must* match a moduleKey (most won't; a flag key is also just a
// generic key any component can check directly via the manifest's own
// featureFlags map), but because a free-for-all string field invites typos
// that silently do nothing. Deliberately not validated against a fixed
// catalog the way permissions are (permission-catalog.ts) — the whole point
// of a flag is that an Admin can create one without a code change.
const SetFeatureFlagInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers, and hyphens only"),
  enabled: z.boolean(),
});

/** Upsert by the model's own `[tenantId, key]` unique constraint — a flag is
 * always either created or flipped, never separately "deleted"; setting
 * `enabled: false` is the disable path (matching real feature-flag systems'
 * own convention, and simpler than a second delete mutation for what's
 * functionally the same outcome here). */
export const featureFlagSetMutation: MutationDefinition<z.infer<typeof SetFeatureFlagInputSchema>> = {
  name: "featureFlag.set",
  inputSchema: SetFeatureFlagInputSchema,
  requiredPermission: "featureFlag:manage",
  async resolve(input, ctx, tx) {
    return tx.featureFlag.upsert({
      where: { tenantId_key: { tenantId: ctx.tenantId, key: input.key } },
      create: { tenantId: ctx.tenantId, key: input.key, enabled: input.enabled },
      update: { enabled: input.enabled },
    });
  },
};
