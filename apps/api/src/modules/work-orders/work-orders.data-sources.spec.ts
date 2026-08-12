import { collapsePermissions } from "../../rbac/permission-collapse";
import { workOrdersWhere, workOrderDetailDataSource } from "./work-orders.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("workOrdersWhere", () => {
  it("returns null for an actor with no workOrder:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await workOrdersWhere(tx, context([]))).toBeNull();
  });

  // workOrder:read stays :tenant even for Production Planner (real :own
  // lives on :update only) — the whole floor needs shared-schedule
  // visibility, mirrors Doctor's patient:read:tenant+patient:update:own
  // shape. A regression guard: even a Planner holding only
  // workOrder:update:own must NOT have their :read narrowed.
  it("stays unrestricted at tenant scope regardless of :own being the only update grant", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await workOrdersWhere(tx, context(["workOrder:read:tenant", "workOrder:update:own"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });
});

describe("workOrders.detail — canUpdate :own scope", () => {
  function detailTx(assignedToId: string | null) {
    return {
      workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", itemId: "i1", assignedToId }) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([{ id: "i1", sku: "SKU-1", name: "Widget" }]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;
  }

  it("canUpdate is true for the assigned Production Planner (own scope)", async () => {
    const tx = detailTx("u1");
    const data = (await workOrderDetailDataSource.resolve({ id: "wo1" }, context(["workOrder:read:tenant", "workOrder:update:own"], "u1"), tx)) as {
      canUpdate: boolean;
    };
    expect(data.canUpdate).toBe(true);
  });

  it("canUpdate is false for a DIFFERENT Production Planner not assigned to this work order — the real :own boundary", async () => {
    const tx = detailTx("someone-else");
    const data = (await workOrderDetailDataSource.resolve({ id: "wo1" }, context(["workOrder:read:tenant", "workOrder:update:own"], "u1"), tx)) as {
      canUpdate: boolean;
    };
    expect(data.canUpdate).toBe(false);
  });

  it("canUpdate is true tenant-wide for Admin regardless of assignment", async () => {
    const tx = detailTx("someone-else");
    const data = (await workOrderDetailDataSource.resolve({ id: "wo1" }, context(["workOrder:read:tenant", "workOrder:update:tenant"], "u1"), tx)) as {
      canUpdate: boolean;
    };
    expect(data.canUpdate).toBe(true);
  });
});
