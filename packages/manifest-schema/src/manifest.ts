import { z } from "zod";
import { UINodeSchema } from "./ui-node";
import { NavItemSchema } from "./nav-item";

export const MANIFEST_SCHEMA_VERSION = 1;

export const WorkspaceManifestSchema = z.object({
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  tenant: z.object({
    id: z.string(),
    name: z.string(),
    workspaceId: z.string().nullable(),
    industry: z.string(),
    branding: z.record(z.string(), z.unknown()),
    profile: z.record(z.string(), z.unknown()),
  }),
  user: z.object({
    id: z.string(),
    displayName: z.string(),
    roles: z.array(z.string()),
    permissionsHash: z.string(),
  }),
  navigation: z.array(NavItemSchema),
  page: UINodeSchema,
  featureFlags: z.record(z.string(), z.boolean()),
  // Global (not per-tenant) — reflects whether the platform operator has
  // configured an AI provider API key at all. Per-tenant/per-plan AI gating
  // is real future scope, not built yet (see CONTEXT.md's AI Assistant
  // Phase A record for why FeatureFlag/Plan.entitlements weren't reused).
  aiAvailable: z.boolean(),
  meta: z.object({ compiledAt: z.string(), etag: z.string() }),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;
