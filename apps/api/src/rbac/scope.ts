import { SCOPES, type Scope } from "@purnit/manifest-schema";

const SCOPE_RANK: Record<Scope, number> = { own: 0, team: 1, department: 2, "department-subtree": 3, tenant: 4 };

export function broaderScope(a: Scope, b: Scope): Scope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export { SCOPES, type Scope };
