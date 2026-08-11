import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { projectsWhere, projectDetailDataSource } from "./projects.data-sources";
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

// Frontend Structural Redesign, Phase 0.
describe("project.detail", () => {
  it("throws NotFoundException when the actor has no project:read grant at all", async () => {
    const detailTx = {} as PrismaTx;
    await expect(projectDetailDataSource.resolve({ id: "p1" }, context([]), detailTx)).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException when the project doesn't exist or is out of the actor's scope", async () => {
    const detailTx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(projectDetailDataSource.resolve({ id: "p1" }, context(["project:read:tenant"]), detailTx)).rejects.toThrow(NotFoundException);
  });

  it("returns the project with resolved owner/department names, members, and counts", async () => {
    const detailTx = {
      project: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "p1", name: "Redesign", description: "A test project", status: "active", ownerId: "u1", departmentId: "d1" }),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Alice" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ projectId: "p1", userId: "u1" }]) },
      department: { findFirst: jest.fn().mockResolvedValue({ name: "Engineering" }) },
      task: { count: jest.fn().mockResolvedValue(4) },
      document: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaTx;

    const result = (await projectDetailDataSource.resolve({ id: "p1" }, context(["project:read:tenant"]), detailTx)) as {
      owner: string | null;
      departmentName: string | null;
      members: { id: string; displayName: string }[];
      taskCount: number;
      documentCount: number;
    };

    expect(result.owner).toBe("Alice");
    expect(result.departmentName).toBe("Engineering");
    expect(result.members).toEqual([{ id: "u1", displayName: "Alice" }]);
    expect(result.taskCount).toBe(4);
    expect(result.documentCount).toBe(2);
  });

  it("has no requiredPermission — visibility is enforced entirely by projectsWhere, same as projects.list", () => {
    expect(projectDetailDataSource.requiredPermission).toBeUndefined();
  });

  it("computes canUpdate/canDelete/canManageMembers/document-capability flags from ctx.effective, not a hardcoded true", async () => {
    const detailTx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", name: "Redesign", ownerId: null, departmentId: null }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      task: { count: jest.fn().mockResolvedValue(0) },
      document: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaTx;

    const readOnly = (await projectDetailDataSource.resolve({ id: "p1" }, context(["project:read:tenant"]), detailTx)) as {
      canUpdate: boolean;
      canDelete: boolean;
      canManageMembers: boolean;
      canCreateDocuments: boolean;
    };
    expect(readOnly).toMatchObject({ canUpdate: false, canDelete: false, canManageMembers: false, canCreateDocuments: false });

    const full = (await projectDetailDataSource.resolve(
      { id: "p1" },
      context(["project:read:tenant", "project:update:tenant", "project:delete:tenant", "document:create:tenant"]),
      detailTx,
    )) as { canUpdate: boolean; canDelete: boolean; canManageMembers: boolean; canCreateDocuments: boolean };
    expect(full).toMatchObject({ canUpdate: true, canDelete: true, canManageMembers: true, canCreateDocuments: true });
  });
});
