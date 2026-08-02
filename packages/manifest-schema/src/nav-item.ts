import { z } from "zod";

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
  /** Absent + `children` present = a pure disclosure group (expand/collapse
   * only, not a link). Present = a real page link, whether or not it also
   * has `children`. */
  pageId?: string;
  children?: NavItem[];
  /** "resource:action" — if absent, the nav item is always visible. */
  requiredPermission?: string;
  /** Entitlement-filter gate; absent = always entitled (core nav, not module-specific). */
  moduleKey?: string;
}

export const NavItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    pageId: z.string().optional(),
    children: z.array(NavItemSchema).optional(),
    requiredPermission: z.string().optional(),
    moduleKey: z.string().optional(),
  }),
);
