import { collapsePermissions } from "../../rbac/permission-collapse";
import { inventoryItemsWhere, inventoryItemsListDataSource, inventoryItemDetailDataSource } from "./inventory-items.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("inventoryItemsWhere", () => {
  it("returns null for an actor with no inventoryItem:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await inventoryItemsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where — no :own concept for InventoryItem in this domain", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await inventoryItemsWhere(tx, context(["inventoryItem:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });
});

describe("inventoryItems.list", () => {
  it("returns [] when the actor has no inventoryItem:read grant", async () => {
    const tx = { inventoryItem: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await inventoryItemsListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });
});

describe("inventoryItems.detail", () => {
  function detailTx(overrides: Partial<{ projectFindFirst: jest.Mock }> = {}) {
    return {
      inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: "i1", filesProjectId: "proj1" }) },
      bOMLine: { count: jest.fn().mockResolvedValue(2) },
      project: { findFirst: overrides.projectFindFirst ?? jest.fn() },
    } as unknown as PrismaTx;
  }

  it("throws NotFoundException for an item that doesn't exist or is out of scope", async () => {
    const tx = { inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(inventoryItemDetailDataSource.resolve({ id: "ghost" }, context(["inventoryItem:read:tenant"]), tx)).rejects.toThrow(
      "No inventory item",
    );
  });

  describe("filesVisible", () => {
    it("is true for an actor holding project:read:tenant", async () => {
      const tx = detailTx({ projectFindFirst: jest.fn().mockResolvedValue({ id: "proj1" }) });
      const data = (await inventoryItemDetailDataSource.resolve(
        { id: "i1" },
        context(["inventoryItem:read:tenant", "project:read:tenant"]),
        tx,
      )) as { filesVisible: boolean };
      expect(data.filesVisible).toBe(true);
    });

    it("is false for an actor with inventoryItem:read but zero project:read at all", async () => {
      const tx = detailTx();
      const data = (await inventoryItemDetailDataSource.resolve({ id: "i1" }, context(["inventoryItem:read:tenant"]), tx)) as {
        filesVisible: boolean;
      };
      expect(data.filesVisible).toBe(false);
      expect((tx as unknown as { project: { findFirst: jest.Mock } }).project.findFirst).not.toHaveBeenCalled();
    });
  });
});
