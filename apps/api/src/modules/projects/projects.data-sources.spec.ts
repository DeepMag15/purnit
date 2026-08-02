import { collapsePermissions } from "../../rbac/permission-collapse";
import { projectsWhere } from "./projects.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

// Never actually invoked by any test below — see tasks.data-sources.spec.ts's
// matching comment.
const tx = {} as PrismaTx;

function context(grants: string[], userDepartmentId: string | null = null): DataSourceContext {
  return {
    tenantId: "t1",
    userId: "u1",
    userDepartmentId,
    effective: collapsePermissions(grants),
  };
}

describe("projectsWhere", () => {
  it("returns null (skip the query) when there is no project:read grant at all", async () => {
    expect(await projectsWhere(tx, context([]), {})).toBeNull();
  });

  it("tenant scope filters only by tenantId", async () => {
    const where = await projectsWhere(tx, context(["project:read:tenant"]), {});
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("own scope filters by ownerId", async () => {
    const where = await projectsWhere(tx, context(["project:read:own"]), {});
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, ownerId: "u1" });
  });

  it("department/team scope ORs department match with having an assigned task or being a project member", async () => {
    const where = await projectsWhere(tx, context(["project:read:department"], "d1"), {});
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      OR: [{ tasks: { some: { assigneeId: "u1", deletedAt: null } } }, { members: { some: { userId: "u1" } } }, { departmentId: "d1" }],
    });
  });

  // Regression test: an earlier version used a non-UUID sentinel string here
  // ("__no_department__"), which Postgres rejected outright (500, not an
  // empty result) since `departmentId` is a `uuid` column. Now: no
  // department at all no longer means "skip the query" — a Member with no
  // department can still see projects containing tasks assigned to them or
  // that they're a direct member of (a real, user-reported bug fix; see the
  // doc comment on projectsWhere).
  it("department/team scope with no department set still returns a query — visible via assigned tasks or membership, not null", async () => {
    expect(await projectsWhere(tx, context(["project:read:team"], null), {})).toEqual({
      tenantId: "t1",
      deletedAt: null,
      OR: [{ tasks: { some: { assigneeId: "u1", deletedAt: null } } }, { members: { some: { userId: "u1" } } }],
    });
  });

  // The actual gap this session's feature closes: a project with no
  // department match and no assigned task is still visible purely because
  // the caller is a direct ProjectMember — the new "Admin assigns Members
  // to a project" mechanism, independent of task assignment.
  it("department/team scope: project membership alone is sufficient, independent of tasks or department", async () => {
    const where = await projectsWhere(tx, context(["project:read:team"], "d1"), {});
    expect(where!.OR as Record<string, unknown>[]).toContainEqual({ members: { some: { userId: "u1" } } });
  });

  it("merges caller-supplied extra filters (e.g. status)", async () => {
    const where = await projectsWhere(tx, context(["project:read:tenant"]), { status: "active" });
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, status: "active" });
  });
});
