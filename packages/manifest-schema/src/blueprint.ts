import { z } from "zod";
import { UINodeSchema } from "./ui-node";
import { NavItemSchema } from "./nav-item";

export const BlueprintRoleDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** The parent role's `id` within the same blueprint's `roles` array. When
   * present, `permissions` is a list of deltas ("x:y:z" adds as-is, "+x:y:z"
   * adds, "-x:y:z" removes) applied on top of the parent's own resolved
   * permissions — see `resolveBlueprintRoles` (apps/api/src/rbac/grant-resolution.ts).
   * When absent, `permissions` is a complete, self-contained grant list. */
  extends: z.string().optional(),
  permissions: z.array(z.string()),
  /** Display order within the tenant's role list — lower shows first (0 =
   * top/highest authority). Optional: falls back to array position when
   * absent (see materializeBlueprintRoles). */
  rank: z.number().int().optional(),
});
export type BlueprintRoleDef = z.infer<typeof BlueprintRoleDefSchema>;

/** A tenant-configurable "flavor" of the universal tier ladder — see
 * ORG_HIERARCHY.md §3–§4. `tierLabels` maps a blueprint role id (a tier) to
 * the display label used when a user's own `Department.type` matches this
 * entry's `id` (e.g. `{ "role.project-manager": "Engineering Manager" }`);
 * absent entries fall back to the tier's own generic `Role.label`.
 * `roleOverrides` is only set for the rare tier where this department type
 * grants genuinely different *permissions*, not just a different label —
 * it points at a distinct, fully-defined role elsewhere in this same
 * blueprint's `roles` array (e.g. HR's Manager tier uses `role.hr-manager`,
 * which extends `role.project-manager` with two bonus grants) rather than
 * inventing a second permission mechanism. Materialized into
 * `DepartmentTypeRoleLabel` at provisioning/reseed time — never read live
 * from this JSON at request time (same discipline as `Role.permissions`). */
export const DepartmentTypeDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  tierLabels: z.record(z.string(), z.string()),
  roleOverrides: z.record(z.string(), z.string()).optional(),
});
export type DepartmentTypeDef = z.infer<typeof DepartmentTypeDefSchema>;

export const BlueprintDefinitionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  industry: z.string(),
  roles: z.array(BlueprintRoleDefSchema),
  departmentTypes: z.array(DepartmentTypeDefSchema).default([]),
  navigation: z.array(NavItemSchema),
  dashboards: z.object({ default: z.string() }),
  modules: z.array(z.string()),
  pages: z.record(z.string(), UINodeSchema),
});
export type BlueprintDefinition = z.infer<typeof BlueprintDefinitionSchema>;
