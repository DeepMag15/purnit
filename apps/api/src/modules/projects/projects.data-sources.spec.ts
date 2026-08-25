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

/** Every `projectsWhere` result now carries an AND-ed restriction gate
 * (Contextual Reporting, 2026-08-25). These helpers let the scope assertions
 * below stay about scope, without pretending the gate isn't there. */
function gateFor(grants: string[]) {
  const held = [...new Set(collapsePermissions(grants).toArray().map((g) => g.split(":").slice(0, 2).join(":")))];
  return {
    OR: [
      { restricted: false },
      { ownerId: "u1" },
      { members: { some: { userId: "u1" } } },
      ...(held.length > 0 ? [{ accessPermission: { in: held } }] : []),
    ],
  };
}

describe("projectsWhere", () => {
  it("returns null (skip the query) when there is no project:read grant at all", async () => {
    expect(await projectsWhere(tx, context([]), {})).toBeNull();
  });

  it("tenant scope filters by tenantId, plus the restriction gate", async () => {
    const where = await projectsWhere(tx, context(["project:read:tenant"]), {});
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, AND: [gateFor(["project:read:tenant"])] });
  });

  it("own scope filters by ownerId", async () => {
    const where = await projectsWhere(tx, context(["project:read:own"]), {});
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, ownerId: "u1", AND: [gateFor(["project:read:own"])] });
  });

  it("department/team scope ORs department match with having an assigned task or being a project member", async () => {
    const where = await projectsWhere(tx, context(["project:read:department"], "d1"), {});
    expect(where).toEqual({
      tenantId: "t1",
      deletedAt: null,
      AND: [
        gateFor(["project:read:department"]),
        { OR: [{ tasks: { some: { assigneeId: "u1", deletedAt: null } } }, { members: { some: { userId: "u1" } } }, { departmentId: "d1" }] },
      ],
    });
  });

  /**
   * ⚠️ The hole these close, found after Contextual Reporting shipped:
   * `project:read:tenant` returned EVERY project, and every domain entity is
   * backed by a real Project — so a patient's chart, a student's private
   * submission and a registrar's student file were all readable by anyone
   * holding that grant. Documents live on those projects, so
   * `documents.list` and `document.getFileUrl` inherited the same reach.
   */
  describe("the restriction gate", () => {
    it("applies at TENANT scope — the whole point, since that scope used to see everything", async () => {
      const where = await projectsWhere(tx, context(["project:read:tenant"]), {});
      const gate = (where!.AND as Record<string, unknown>[])[0]!.OR as Record<string, unknown>[];
      expect(gate).toContainEqual({ restricted: false });
      expect(gate).toContainEqual({ ownerId: "u1" });
      expect(gate).toContainEqual({ members: { some: { userId: "u1" } } });
    });

    it("applies at department scope too, AND-ed so the department path is not a way around it", async () => {
      const where = await projectsWhere(tx, context(["project:read:department"], "d1"), {});
      const and = where!.AND as Record<string, unknown>[];
      // Two separate AND clauses: gate first, scope second. Merged into one OR
      // the department match alone would satisfy the query.
      expect(and).toHaveLength(2);
      expect((and[0]!.OR as unknown[]).length).toBeGreaterThan(0);
      expect(and[1]).toHaveProperty("OR");
    });

    it("lets a caller in via a permission the project names — how a Nurse reaches any chart", async () => {
      // Charts carry accessPermission "patient:update". A Nurse holds
      // patient:update:own and is not a member of every chart.
      const where = await projectsWhere(tx, context(["project:read:tenant", "patient:update:own"]), {});
      const gate = (where!.AND as Record<string, unknown>[])[0]!.OR as Record<string, unknown>[];
      const byPermission = gate.find((c) => "accessPermission" in c) as { accessPermission: { in: string[] } };
      expect(byPermission.accessPermission.in).toContain("patient:update");
    });

    it("does NOT let a Receptionist in on the clinical permission they lack", async () => {
      // Receptionist holds patient:read and appointment:update, never
      // patient:update — so charts stay out of reach even at tenant scope.
      const where = await projectsWhere(tx, context(["project:read:tenant", "patient:read:tenant", "appointment:update:tenant"]), {});
      const gate = (where!.AND as Record<string, unknown>[])[0]!.OR as Record<string, unknown>[];
      const byPermission = gate.find((c) => "accessPermission" in c) as { accessPermission: { in: string[] } };
      expect(byPermission.accessPermission.in).not.toContain("patient:update");
    });

    it("offers no permission path at all to a caller holding nothing but project:read", async () => {
      // A student submissions project carries NO accessPermission, so this is
      // the case that matters: owner or member, or nothing.
      const where = await projectsWhere(tx, context(["project:read:tenant"]), {});
      const gate = (where!.AND as Record<string, unknown>[])[0]!.OR as Record<string, unknown>[];
      const byPermission = gate.find((c) => "accessPermission" in c) as { accessPermission: { in: string[] } } | undefined;
      // "project:read" is held, but no project names it, so this can never
      // match a restricted row.
      expect(byPermission?.accessPermission.in).toEqual(["project:read"]);
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
      AND: [
        gateFor(["project:read:team"]),
        { OR: [{ tasks: { some: { assigneeId: "u1", deletedAt: null } } }, { members: { some: { userId: "u1" } } }] },
      ],
    });
  });

  // The actual gap this session's feature closes: a project with no
  // department match and no assigned task is still visible purely because
  // the caller is a direct ProjectMember — the new "Admin assigns Members
  // to a project" mechanism, independent of task assignment.
  it("department/team scope: project membership alone is sufficient, independent of tasks or department", async () => {
    const where = await projectsWhere(tx, context(["project:read:team"], "d1"), {});
    const scopeOr = (where!.AND as Record<string, unknown>[])[1]!.OR as Record<string, unknown>[];
    expect(scopeOr).toContainEqual({ members: { some: { userId: "u1" } } });
  });

  it("merges caller-supplied extra filters (e.g. status)", async () => {
    const where = await projectsWhere(tx, context(["project:read:tenant"]), { status: "active" });
    expect(where).toMatchObject({ tenantId: "t1", deletedAt: null, status: "active" });
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
