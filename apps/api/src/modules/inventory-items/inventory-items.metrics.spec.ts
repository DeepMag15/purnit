import { collapsePermissions } from "../../rbac/permission-collapse";
import { inventoryItemsLowStockCountMetric, inventoryItemsTotalValueMetric, inventoryItemsTypeBreakdownMetric } from "./inventory-items.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("inventoryItemsLowStockCountMetric", () => {
  it("requires inventoryItem:read", () => {
    expect(inventoryItemsLowStockCountMetric.requiredPermission).toBe("inventoryItem:read");
  });

  it("returns 0 and never queries with no inventoryItem:read grant", async () => {
    const tx = { inventoryItem: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await inventoryItemsLowStockCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { inventoryItem: { findMany: jest.Mock } }).inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it("counts an item exactly at its reorder point as low (boundary is inclusive)", async () => {
    const tx = {
      inventoryItem: { findMany: jest.fn().mockResolvedValue([{ currentStock: 5, reorderPoint: 5 }]) },
    } as unknown as PrismaTx;
    const value = await inventoryItemsLowStockCountMetric.computeLive(context(["inventoryItem:read:tenant"]), tx);
    expect(value).toBe(1);
  });

  it("excludes an item above its reorder point", async () => {
    const tx = {
      inventoryItem: { findMany: jest.fn().mockResolvedValue([{ currentStock: 10, reorderPoint: 5 }]) },
    } as unknown as PrismaTx;
    const value = await inventoryItemsLowStockCountMetric.computeLive(context(["inventoryItem:read:tenant"]), tx);
    expect(value).toBe(0);
  });

  it("counts only the items below/at reorder point across a mixed set", async () => {
    const tx = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          { currentStock: 2, reorderPoint: 5 }, // low
          { currentStock: 10, reorderPoint: 5 }, // fine
          { currentStock: 0, reorderPoint: 0 }, // low (boundary)
        ]),
      },
    } as unknown as PrismaTx;
    const value = await inventoryItemsLowStockCountMetric.computeLive(context(["inventoryItem:read:tenant"]), tx);
    expect(value).toBe(2);
  });
});

describe("inventoryItemsTotalValueMetric", () => {
  it("requires inventoryItem:read and formats as currency", () => {
    expect(inventoryItemsTotalValueMetric.requiredPermission).toBe("inventoryItem:read");
    expect(inventoryItemsTotalValueMetric.format).toBe("currency");
  });

  it("returns 0 with no inventoryItem:read grant", async () => {
    const tx = { inventoryItem: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await inventoryItemsTotalValueMetric.computeLive(context([]), tx)).toBe(0);
  });

  it("sums currentStock x unitCost across every item in scope", async () => {
    const tx = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          { currentStock: 10, unitCost: 500 }, // 5000
          { currentStock: 3, unitCost: 2000 }, // 6000
        ]),
      },
    } as unknown as PrismaTx;
    const value = await inventoryItemsTotalValueMetric.computeLive(context(["inventoryItem:read:tenant"]), tx);
    expect(value).toBe(11000);
  });
});

describe("inventoryItemsTypeBreakdownMetric", () => {
  it("requires inventoryItem:read", () => {
    expect(inventoryItemsTypeBreakdownMetric.requiredPermission).toBe("inventoryItem:read");
  });

  it("returns [] with no inventoryItem:read grant", async () => {
    const tx = { inventoryItem: { groupBy: jest.fn() } } as unknown as PrismaTx;
    expect(await inventoryItemsTypeBreakdownMetric.computeLive(context([]), tx)).toEqual([]);
  });

  it("groups by type", async () => {
    const tx = {
      inventoryItem: {
        groupBy: jest.fn().mockResolvedValue([
          { type: "raw_material", _count: { _all: 3 } },
          { type: "finished_good", _count: { _all: 2 } },
        ]),
      },
    } as unknown as PrismaTx;
    const value = await inventoryItemsTypeBreakdownMetric.computeLive(context(["inventoryItem:read:tenant"]), tx);
    expect(value).toEqual([
      { type: "raw_material", count: 3 },
      { type: "finished_good", count: 2 },
    ]);
  });
});
