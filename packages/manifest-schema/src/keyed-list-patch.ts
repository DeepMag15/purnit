import { z } from "zod";

export interface KeyedListPatch<T extends { id: string }> {
  remove?: string[];
  add?: { after?: string; before?: string; item: T }[];
  patch?: Record<string, Partial<T>>;
}

/**
 * The one stable-id add/remove/patch mechanism, reused for navigation and
 * page-children overrides (ARCHITECTURE.md §6.3).
 *
 * `patch` values are intentionally loose (`Record<string, unknown>`), not a
 * strict `itemSchema.partial()`: our item schemas (UINode, NavItem) are
 * recursive via `z.lazy()`, and Zod's `.partial()` doesn't compose with
 * `ZodLazy` in v4. `add.item` is still fully validated against `itemSchema`
 * — only patches (inherently partial by nature) skip strict shape validation.
 */
export function keyedListPatchSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    remove: z.array(z.string()).optional(),
    add: z
      .array(z.object({ after: z.string().optional(), before: z.string().optional(), item: itemSchema }))
      .optional(),
    patch: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  });
}
