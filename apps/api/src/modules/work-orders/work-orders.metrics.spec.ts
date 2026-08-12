import { collapsePermissions } from "../../rbac/permission-collapse";
import { workOrdersInProgressCountMetric } from "./work-orders.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("workOrdersInProgressCountMetric", () => {
  it("requires workOrder:read", () => {
    expect(workOrdersInProgressCountMetric.requiredPermission).toBe("workOrder:read");
  });

  it("returns 0 and never queries with no workOrder:read grant", async () => {
    const tx = { workOrder: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await workOrdersInProgressCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { workOrder: { count: jest.Mock } }).workOrder.count).not.toHaveBeenCalled();
  });

  it("filters by status: in_progress", async () => {
    const tx = { workOrder: { count: jest.fn().mockResolvedValue(2) } } as unknown as PrismaTx;
    const value = await workOrdersInProgressCountMetric.computeLive(context(["workOrder:read:tenant"]), tx);
    expect(value).toBe(2);
    const call = (tx as unknown as { workOrder: { count: jest.Mock } }).workOrder.count.mock.calls[0][0];
    expect(call.where.status).toBe("in_progress");
  });

  it("is not narrowed by :own — workOrder:read stays tenant-wide even for a Production Planner", async () => {
    const tx = { workOrder: { count: jest.fn().mockResolvedValue(5) } } as unknown as PrismaTx;
    const value = await workOrdersInProgressCountMetric.computeLive(context(["workOrder:read:tenant", "workOrder:update:own"]), tx);
    expect(value).toBe(5);
    const call = (tx as unknown as { workOrder: { count: jest.Mock } }).workOrder.count.mock.calls[0][0];
    expect(call.where.assignedToId).toBeUndefined();
  });
});
