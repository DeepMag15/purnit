import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  purchaseOrdersWhere,
  purchaseOrdersListDataSource,
  purchaseOrderDetailDataSource,
  purchaseOrdersCapabilitiesDataSource,
} from "./purchase-orders.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("purchaseOrdersWhere", () => {
  it("returns null for an actor with no purchaseOrder:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await purchaseOrdersWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where — no :own concept for PurchaseOrder in this domain", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await purchaseOrdersWhere(tx, context(["purchaseOrder:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });
});

describe("purchaseOrders.list", () => {
  it("returns [] when the actor has no purchaseOrder:read grant", async () => {
    const tx = { purchaseOrder: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await purchaseOrdersListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });

  it("joins supplierName", async () => {
    const tx = {
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([{ id: "po1", supplierId: "s1" }]) },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: "s1", name: "Acme Supply" }]) },
    } as unknown as PrismaTx;

    const rows = (await purchaseOrdersListDataSource.resolve({}, context(["purchaseOrder:read:tenant"]), tx)) as {
      id: string;
      supplierName: string;
    }[];
    expect(rows).toEqual([{ id: "po1", supplierId: "s1", supplierName: "Acme Supply" }]);
  });

  it("layers a supplierId filter onto the scope condition", async () => {
    const tx = {
      purchaseOrder: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;
    await purchaseOrdersListDataSource.resolve({ supplierId: "s1" }, context(["purchaseOrder:read:tenant"]), tx);
    const call = (tx as unknown as { purchaseOrder: { findMany: jest.Mock } }).purchaseOrder.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ supplierId: "s1" });
  });
});

describe("purchaseOrders.detail", () => {
  it("throws NotFoundException for a purchase order that doesn't exist or is out of scope", async () => {
    const tx = { purchaseOrder: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(purchaseOrderDetailDataSource.resolve({ id: "ghost" }, context(["purchaseOrder:read:tenant"]), tx)).rejects.toThrow(
      "No purchase order",
    );
  });

  it("computes canUpdate/canReceive from effective permissions", async () => {
    const tx = {
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: "po1", supplierId: "s1" }) },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: "s1", name: "Acme Supply" }]) },
    } as unknown as PrismaTx;

    const data = (await purchaseOrderDetailDataSource.resolve(
      { id: "po1" },
      context(["purchaseOrder:read:tenant", "purchaseOrder:receive:tenant"]),
      tx,
    )) as { canUpdate: boolean; canReceive: boolean };
    expect(data.canUpdate).toBe(false);
    expect(data.canReceive).toBe(true);
  });
});

describe("purchaseOrders.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("all false with no grants at all", async () => {
    expect(await purchaseOrdersCapabilitiesDataSource.resolve({}, context([]), tx)).toEqual({ canCreate: false, canUpdateStatus: false });
  });

  it("canCreate true with only purchaseOrder:create", async () => {
    expect(await purchaseOrdersCapabilitiesDataSource.resolve({}, context(["purchaseOrder:create:tenant"]), tx)).toEqual({
      canCreate: true,
      canUpdateStatus: false,
    });
  });

  it("canUpdateStatus true with only purchaseOrder:update — a genuinely different resource action from purchaseOrder:create", async () => {
    expect(await purchaseOrdersCapabilitiesDataSource.resolve({}, context(["purchaseOrder:update:own"]), tx)).toEqual({
      canCreate: false,
      canUpdateStatus: true,
    });
  });

  it("both true for a role holding both grants", async () => {
    expect(
      await purchaseOrdersCapabilitiesDataSource.resolve({}, context(["purchaseOrder:create:tenant", "purchaseOrder:update:tenant"]), tx),
    ).toEqual({ canCreate: true, canUpdateStatus: true });
  });
});
