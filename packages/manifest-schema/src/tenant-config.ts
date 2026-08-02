import { z } from "zod";
import { UINodeSchema } from "./ui-node";
import { NavItemSchema } from "./nav-item";
import { BlueprintRoleDefSchema } from "./blueprint";
import { keyedListPatchSchema } from "./keyed-list-patch";

export const PagePatchSchema = z
  .object({ children: keyedListPatchSchema(UINodeSchema).optional() })
  .catchall(z.unknown());
export type PagePatch = z.infer<typeof PagePatchSchema>;

export const TenantConfigOverridesSchema = z.object({
  navigation: keyedListPatchSchema(NavItemSchema).optional(),
  pages: z.object({ patch: z.record(z.string(), PagePatchSchema).optional() }).optional(),
  roles: z.object({ add: z.array(BlueprintRoleDefSchema).optional() }).optional(),
});
export type TenantConfigOverrides = z.infer<typeof TenantConfigOverridesSchema>;
