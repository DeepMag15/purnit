import { collapsePermissions } from "../../rbac/permission-collapse";
import { purchaseOrdersOpenCountMetric, purchaseOrdersTotalOpenValueMetric } from "./purchase-orders.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("purchaseOrdersOpenCountMetric", () => {
  it("requires purchaseOrder:read", () => {
    expect(purchaseOrdersOpenCountMetric.requiredPermission).toBe("purchaseOrder:read");
  });

  it("returns 0 and never queries with no purchaseOrder:read grant", async () => {
    const tx = { purchaseOrder: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await purchaseOrdersOpenCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { purchaseOrder: { count: jest.Mock } }).purchaseOrder.count).not.toHaveBeenCalled();
  });

  it("filters by status in [draft, submitted]", async () => {
    const tx = { purchaseOrder: { count: jest.fn().mockResolvedValue(3) } } as unknown as PrismaTx;
    const value = await purchaseOrdersOpenCountMetric.computeLive(context(["purchaseOrder:read:tenant"]), tx);
    expect(value).toBe(3);
    const call = (tx as unknown as { purchaseOrder: { count: jest.Mock } }).purchaseOrder.count.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ["draft", "submitted"] });
  });
});

describe("purchaseOrdersTotalOpenValueMetric", () => {
  it("requires purchaseOrder:read and formats as currency", () => {
    expect(purchaseOrdersTotalOpenValueMetric.requiredPermission).toBe("purchaseOrder:read");
    expect(purchaseOrdersTotalOpenValueMetric.format).toBe("currency");
  });

  it("returns 0 with no purchaseOrder:read grant", async () => {
    const tx = { purchaseOrder: { aggregate: jest.fn() } } as unknown as PrismaTx;
    expect(await purchaseOrdersTotalOpenValueMetric.computeLive(context([]), tx)).toBe(0);
  });

  it("sums total only for submitted orders, deliberately excluding draft", async () => {
    const tx = {
      purchaseOrder: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 15000 } }) },
    } as unknown as PrismaTx;
    const value = await purchaseOrdersTotalOpenValueMetric.computeLive(context(["purchaseOrder:read:tenant"]), tx);
    expect(value).toBe(15000);
    const call = (tx as unknown as { purchaseOrder: { aggregate: jest.Mock } }).purchaseOrder.aggregate.mock.calls[0][0];
    expect(call.where.status).toBe("submitted");
  });

  it("returns 0 when there are no submitted orders at all", async () => {
    const tx = {
      purchaseOrder: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: null } }) },
    } as unknown as PrismaTx;
    const value = await purchaseOrdersTotalOpenValueMetric.computeLive(context(["purchaseOrder:read:tenant"]), tx);
    expect(value).toBe(0);
  });
});
