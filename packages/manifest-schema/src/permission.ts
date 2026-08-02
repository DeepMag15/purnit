import { z } from "zod";

// Narrowest to broadest — broadest granted scope wins when the same
// resource:action is granted at multiple scopes (ARCHITECTURE.md §5.2).
// "department-subtree" sits between "department" and "tenant" — an
// Executive's authority reaches their own department AND all of its
// descendants (walking Department.parentId down), not just an exact match.
// See ORG_HIERARCHY.md §8.
export const SCOPES = ["own", "team", "department", "department-subtree", "tenant"] as const;
export const ScopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof ScopeSchema>;

export const PermissionTripleSchema = z.object({
  resource: z.string(),
  action: z.string(),
  scope: ScopeSchema,
});
export type PermissionTriple = z.infer<typeof PermissionTripleSchema>;

/** Parses a "resource:action:scope" string, e.g. "project:delete:tenant". */
export function parsePermissionString(raw: string): PermissionTriple {
  const parts = raw.split(":");
  if (parts.length !== 3) {
    throw new Error(`Malformed permission string "${raw}" — expected "resource:action:scope"`);
  }
  const [resource, action, scope] = parts;
  return PermissionTripleSchema.parse({ resource, action, scope });
}
