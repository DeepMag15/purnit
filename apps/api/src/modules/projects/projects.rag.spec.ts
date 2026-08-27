import { projectRagHandler } from "./projects.rag";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function ctx(grants: string[] = ["project:read:tenant"]) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) } satisfies DataSourceContext;
}

describe("projectRagHandler", () => {
  it("has sourceType 'project'", () => {
    expect(projectRagHandler.sourceType).toBe("project");
  });

  describe("checkVisibilityAndGetName", () => {
    it("returns null when the project is gone/soft-deleted", async () => {
      const tx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await projectRagHandler.checkVisibilityAndGetName(tx, ctx(), "p1")).toBeNull();
    });

    it("returns the name when in scope", async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: "p1", name: "Website Revamp" });
      const tx = { project: { findFirst } } as unknown as PrismaTx;
      expect(await projectRagHandler.checkVisibilityAndGetName(tx, ctx(), "p1")).toBe("Website Revamp");
    });

    it("returns null when out of scope (no grant at all)", async () => {
      const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", name: "Website Revamp" }) } } as unknown as PrismaTx;
      expect(await projectRagHandler.checkVisibilityAndGetName(tx, ctx([]), "p1")).toBeNull();
    });
  });

  describe("checkVisibilityAndGetNames (AI Assistant Phase F — batch)", () => {
    it("returns a Map with only the projects findMany actually returned (already RBAC-scoped)", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "p1", name: "Website Revamp" }]);
      const tx = { project: { findMany } } as unknown as PrismaTx;

      const result = await projectRagHandler.checkVisibilityAndGetNames!(tx, ctx(), ["p1", "p2"]);

      expect(result).toEqual(new Map([["p1", "Website Revamp"]]));
      expect(findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ["p1", "p2"] } });
    });

    it("returns an empty Map when the caller has no project:read grant at all — projectsWhere returns null", async () => {
      const tx = { project: { findMany: jest.fn() } } as unknown as PrismaTx;
      const result = await projectRagHandler.checkVisibilityAndGetNames!(tx, ctx([]), ["p1"]);
      expect(result).toEqual(new Map());
    });
  });

  describe("extractText", () => {
    it("returns null when the project is gone", async () => {
      const tx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await projectRagHandler.extractText(tx, "t1", "p1")).toBeNull();
    });

    it("composes name + description", async () => {
      const tx = { project: { findFirst: jest.fn().mockResolvedValue({ name: "Website Revamp", description: "Q3 redesign" }) } } as unknown as PrismaTx;
      expect(await projectRagHandler.extractText(tx, "t1", "p1")).toBe("Website Revamp\nQ3 redesign");
    });

    it("falls back to just the name when there's no description", async () => {
      const tx = { project: { findFirst: jest.fn().mockResolvedValue({ name: "Website Revamp", description: null }) } } as unknown as PrismaTx;
      expect(await projectRagHandler.extractText(tx, "t1", "p1")).toBe("Website Revamp");
    });
  });
});
