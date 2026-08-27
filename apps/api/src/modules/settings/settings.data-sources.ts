import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

const SettingsCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 04 — `WorkspaceSettings.tsx`'s move off the
 * generic Renderer loses the `actions` prop its edit controls currently
 * check. 6 of its 9 gated mutations (`tenant.updateBranding/updateWorkspaceId/
 * updateProfile/createLogoUploadUrl`, `workspaceConfig.updateNavigationLabel/
 * updateAiProvider`) declare `requiredPermission: "settings:manage"` and
 * collapse to one `canManageSettings` flag — but `billing.createCheckoutSession`,
 * `featureFlag.set`, and `sso.configure` each declare a genuinely different
 * resource (`billing:manage`/`featureFlag:manage`/`sso:manage`, confirmed
 * directly against each mutation, not assumed from "they're all Settings
 * cards"), so 4 flags total, not 1 — same `canBrowseOrg`/`canBrowseProjects`-
 * style split Phase 03 needed for Analytics, and Phase 04 needed again for
 * `hr.capabilities`. No `requiredPermission` of its own (callable by
 * anyone), same precedent as `analytics.capabilities`. */
export const settingsCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof SettingsCapabilitiesParamsSchema>> = {
  name: "settings.capabilities",
  paramsSchema: SettingsCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canManageSettings: ctx.effective.has("settings", "manage") !== null,
      canManageBilling: ctx.effective.has("billing", "manage") !== null,
      canManageFeatureFlags: ctx.effective.has("featureFlag", "manage") !== null,
      canManageSso: ctx.effective.has("sso", "manage") !== null,
    };
  },
};
