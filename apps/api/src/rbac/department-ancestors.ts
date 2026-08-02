import type { PrismaTx } from "../tenancy/tenant-prisma.service";

/**
 * Resolves the ancestor chain from `departmentId` up to the root, walking
 * `Department.parentId` **up** (the given department plus every ancestor) —
 * the read-side inverse of `getDepartmentSubtreeIds` (department-subtree.ts).
 * Same "single recursive CTE, not a materialized closure table" shape and
 * "department trees are small, don't optimize before it's needed" reasoning.
 *
 * Purpose-built for Announcements' read-visibility check: rather than
 * resolving each candidate announcement's own subtree (expensive across N
 * differently-targeted announcements), resolve the READER's ancestor chain
 * once per request, then `WHERE department_id IS NULL OR department_id =
 * ANY(ancestorIds)` covers every announcement in one pass — an announcement
 * targeting department D is visible to a reader in D or any descendant of D
 * because D necessarily appears in that reader's own ancestor chain.
 *
 * Deliberately ignores `Department.archivedAt`, same as
 * `getDepartmentSubtreeIds` — an archived department still has a real place
 * in the hierarchy for this walk.
 */
export async function getDepartmentAncestorIds(tx: PrismaTx, tenantId: string, departmentId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM departments WHERE id = ${departmentId}::uuid AND tenant_id = ${tenantId}::uuid
      UNION ALL
      SELECT d.id, d.parent_id FROM departments d
      INNER JOIN ancestors a ON d.id = a.parent_id
      WHERE d.tenant_id = ${tenantId}::uuid
    )
    SELECT id FROM ancestors
  `;
  return rows.map((r) => r.id);
}
