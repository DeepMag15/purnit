import { collapsePermissions } from "../../rbac/permission-collapse";
import { clientsTotalCountMetric, clientsStatusBreakdownMetric } from "./clients.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("clients metrics", () => {
  it("clientsTotalCountMetric requires client:read", () => {
    expect(clientsTotalCountMetric.requiredPermission).toBe("client:read");
  });

  it("clientsTotalCountMetric.computeLive calls through clientsWhere", async () => {
    const tx = { client: { count: jest.fn().mockResolvedValue(6) } } as unknown as PrismaTx;
    const value = await clientsTotalCountMetric.computeLive(context(["client:read:tenant"]), tx);
    expect(value).toBe(6);
    const call = (tx as unknown as { client: { count: jest.Mock } }).client.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1" });
  });

  it("clientsTotalCountMetric.computeLive returns 0 with no client:read grant", async () => {
    const tx = { client: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await clientsTotalCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { client: { count: jest.Mock } }).client.count).not.toHaveBeenCalled();
  });

  it("clientsStatusBreakdownMetric requires client:read and is a breakdown", () => {
    expect(clientsStatusBreakdownMetric.requiredPermission).toBe("client:read");
    expect(clientsStatusBreakdownMetric.kind).toBe("breakdown");
  });

  it("clientsStatusBreakdownMetric.computeLive maps groupBy results to {status, count}", async () => {
    const tx = {
      client: { groupBy: jest.fn().mockResolvedValue([{ status: "active", _count: { _all: 4 } }]) },
    } as unknown as PrismaTx;
    const rows = await clientsStatusBreakdownMetric.computeLive(context(["client:read:tenant"]), tx);
    expect(rows).toEqual([{ status: "active", count: 4 }]);
  });

  it("clientsStatusBreakdownMetric.computeLive returns [] with no grant", async () => {
    const tx = { client: { groupBy: jest.fn() } } as unknown as PrismaTx;
    expect(await clientsStatusBreakdownMetric.computeLive(context([]), tx)).toEqual([]);
    expect((tx as unknown as { client: { groupBy: jest.Mock } }).client.groupBy).not.toHaveBeenCalled();
  });
});
