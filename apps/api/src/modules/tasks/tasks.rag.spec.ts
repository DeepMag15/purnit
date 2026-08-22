import { taskRagHandler } from "./tasks.rag";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function ctx(grants: string[] = ["task:read:tenant"]) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) } satisfies DataSourceContext;
}

describe("taskRagHandler", () => {
  it("has sourceType 'task'", () => {
    expect(taskRagHandler.sourceType).toBe("task");
  });

  describe("checkVisibilityAndGetName", () => {
    it("returns null when the task is gone/soft-deleted", async () => {
      const tx = { task: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await taskRagHandler.checkVisibilityAndGetName(tx, ctx(), "tk1")).toBeNull();
    });

    it("returns the title when in scope", async () => {
      const tx = { task: { findFirst: jest.fn().mockResolvedValue({ id: "tk1", title: "Fix bug" }) } } as unknown as PrismaTx;
      expect(await taskRagHandler.checkVisibilityAndGetName(tx, ctx(), "tk1")).toBe("Fix bug");
    });

    it("returns null when out of scope (no grant at all)", async () => {
      const tx = { task: { findFirst: jest.fn().mockResolvedValue({ id: "tk1", title: "Fix bug" }) } } as unknown as PrismaTx;
      expect(await taskRagHandler.checkVisibilityAndGetName(tx, ctx([]), "tk1")).toBeNull();
    });
  });

  describe("checkVisibilityAndGetNames (AI Assistant Phase F — batch)", () => {
    it("returns a Map with only the tasks findMany actually returned (already RBAC-scoped)", async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: "tk1", title: "Fix bug" },
        { id: "tk2", title: "Write docs" },
      ]);
      const tx = { task: { findMany } } as unknown as PrismaTx;

      const result = await taskRagHandler.checkVisibilityAndGetNames!(tx, ctx(), ["tk1", "tk2", "tk3"]);

      expect(result).toEqual(new Map([["tk1", "Fix bug"], ["tk2", "Write docs"]]));
      expect(findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ["tk1", "tk2", "tk3"] } });
    });

    it("returns an empty Map when the caller has no task:read grant at all — tasksWhere returns null", async () => {
      const tx = { task: { findMany: jest.fn() } } as unknown as PrismaTx;
      const result = await taskRagHandler.checkVisibilityAndGetNames!(tx, ctx([]), ["tk1"]);
      expect(result).toEqual(new Map());
    });
  });

  describe("extractText", () => {
    it("returns null when the task is gone", async () => {
      const tx = { task: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await taskRagHandler.extractText(tx, "t1", "tk1")).toBeNull();
    });

    it("composes title + description", async () => {
      const tx = { task: { findFirst: jest.fn().mockResolvedValue({ title: "Fix bug", description: "Null pointer on save" }) } } as unknown as PrismaTx;
      expect(await taskRagHandler.extractText(tx, "t1", "tk1")).toBe("Fix bug\nNull pointer on save");
    });
  });
});
