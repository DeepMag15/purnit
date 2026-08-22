import { z } from "zod";
import type { DataSourceDefinition } from "../../data-sources/data-source-registry.service";

const ListParamsSchema = z.object({});

/** Admin-only view of every flag actually set for this tenant. Separate
 * from `compileWorkspace`'s own `manifest.featureFlags` map (which every
 * authenticated user gets, unconditionally, for any component to check a
 * key directly) — this one exposes row metadata (id, createdAt) an admin
 * UI needs but the manifest doesn't. */
export const featureFlagsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "featureFlags.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "featureFlag:manage",
  async resolve(_params, ctx, tx) {
    return tx.featureFlag.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { key: "asc" } });
  },
};
