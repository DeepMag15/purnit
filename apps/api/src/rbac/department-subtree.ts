import type { PrismaTx } from "../tenancy/tenant-prisma.service";

/**
 * Resolves every department id reachable from `departmentId` by walking
 * `Department.parentId` **down** (the given department plus all of its
 * descendants), via a single recursive CTE — not a materialized closure
 * table. Department trees are small per tenant; per ORG_HIERARCHY.md §8,
 * this is the "don't optimize before it's needed" starting point, matching
 * this project's existing pattern elsewhere. Revisit only if department
 * trees turn out deep/wide enough for this to matter.
 *
 * Deliberately kept as its own explicit, on-demand async call rather than
 * folded into `isRowInScope` itself — callers only pay for this query when
 * the resolved scope is actually `"department-subtree"`, and `isRowInScope`
 * stays a pure, synchronous, easily-unit-tested function.
 */
export async function getDepartmentSubtreeIds(tx: PrismaTx, tenantId: string, departmentId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM departments WHERE id = ${departmentId}::uuid AND tenant_id = ${tenantId}::uuid
      UNION ALL
      SELECT d.id FROM departments d
      INNER JOIN subtree s ON d.parent_id = s.id
      WHERE d.tenant_id = ${tenantId}::uuid
    )
    SELECT id FROM subtree
  `;
  return rows.map((r) => r.id);
}
