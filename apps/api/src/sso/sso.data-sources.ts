import { z } from "zod";
import type { DataSourceDefinition } from "../data-sources/data-source-registry.service";

const GetParamsSchema = z.object({});

export interface SsoConfigView {
  enabled: boolean;
  idpAlias: string | null;
  displayName: string | null;
  defaultRoleId: string | null;
  requireEmailVerified: boolean;
}

/** Admin-facing config read for the "Enterprise SSO" Settings card — safe
 * null-ish shape before `sso.configure` has ever been called for this
 * tenant (no `SsoConfig` row exists yet). */
export const ssoGetDataSource: DataSourceDefinition<z.infer<typeof GetParamsSchema>> = {
  name: "sso.get",
  paramsSchema: GetParamsSchema,
  requiredPermission: "sso:manage",
  async resolve(_params, ctx, tx) {
    const config = await tx.ssoConfig.findUnique({ where: { tenantId: ctx.tenantId } });
    if (!config) {
      return { enabled: false, idpAlias: null, displayName: null, defaultRoleId: null, requireEmailVerified: true } satisfies SsoConfigView;
    }
    return {
      enabled: config.enabled,
      idpAlias: config.idpAlias,
      displayName: config.displayName,
      defaultRoleId: config.defaultRoleId,
      requireEmailVerified: config.requireEmailVerified,
    } satisfies SsoConfigView;
  },
};
