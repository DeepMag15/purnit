import { collapsePermissions } from "../../rbac/permission-collapse";
import { suppliersWhere, suppliersListDataSource, supplierDetailDataSource, suppliersCapabilitiesDataSource } from "./suppliers.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("suppliersWhere", () => {
  it("returns null for an actor with no supplier:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await suppliersWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where — no :own concept for Supplier in this domain", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await suppliersWhere(tx, context(["supplier:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });
});

describe("suppliers.list", () => {
  it("returns [] when the actor has no supplier:read grant", async () => {
    const tx = { supplier: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await suppliersListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });

  it("joins purchaseOrderCount", async () => {
    const tx = {
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: "s1" }]) },
      purchaseOrder: { groupBy: jest.fn().mockResolvedValue([{ supplierId: "s1", _count: { supplierId: 3 } }]) },
    } as unknown as PrismaTx;

    const rows = (await suppliersListDataSource.resolve({}, context(["supplier:read:tenant"]), tx)) as { id: string; purchaseOrderCount: number }[];
    expect(rows).toEqual([{ id: "s1", purchaseOrderCount: 3 }]);
  });
});

describe("suppliers.detail", () => {
  it("throws NotFoundException for a supplier that doesn't exist or is out of scope", async () => {
    const tx = { supplier: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(supplierDetailDataSource.resolve({ id: "ghost" }, context(["supplier:read:tenant"]), tx)).rejects.toThrow("No supplier");
  });

  it("computes canUpdate/canReadPurchaseOrders from effective permissions", async () => {
    const tx = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
      purchaseOrder: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaTx;

    const data = (await supplierDetailDataSource.resolve(
      { id: "s1" },
      context(["supplier:read:tenant", "purchaseOrder:read:tenant"]),
      tx,
    )) as { canUpdate: boolean; canReadPurchaseOrders: boolean };
    expect(data.canUpdate).toBe(false);
    expect(data.canReadPurchaseOrders).toBe(true);
  });
});

describe("suppliers.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("all false with no grants at all", async () => {
    expect(await suppliersCapabilitiesDataSource.resolve({}, context([]), tx)).toEqual({ canCreate: false, canUpdateStatus: false });
  });

  it("canCreate true with only supplier:create", async () => {
    expect(await suppliersCapabilitiesDataSource.resolve({}, context(["supplier:create:tenant"]), tx)).toEqual({
      canCreate: true,
      canUpdateStatus: false,
    });
  });

  it("canUpdateStatus true with only supplier:update — a genuinely different resource action from supplier:create", async () => {
    expect(await suppliersCapabilitiesDataSource.resolve({}, context(["supplier:update:own"]), tx)).toEqual({
      canCreate: false,
      canUpdateStatus: true,
    });
  });

  it("both true for a role holding both grants", async () => {
    expect(await suppliersCapabilitiesDataSource.resolve({}, context(["supplier:create:tenant", "supplier:update:tenant"]), tx)).toEqual({
      canCreate: true,
      canUpdateStatus: true,
    });
  });
});
