import { collapsePermissions } from "../../rbac/permission-collapse";
import { paymentsCollectedThisMonthMetric } from "./payments.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("paymentsCollectedThisMonthMetric", () => {
  it("requires payment:read and formats as currency", () => {
    expect(paymentsCollectedThisMonthMetric.requiredPermission).toBe("payment:read");
    expect(paymentsCollectedThisMonthMetric.format).toBe("currency");
  });

  it("computeLive sums payment amounts via aggregate, filtered to the current UTC month", async () => {
    const tx = { payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 5000 } }) } } as unknown as PrismaTx;
    const value = await paymentsCollectedThisMonthMetric.computeLive(context(["payment:read:tenant"]), tx);
    expect(value).toBe(5000);
    const call = (tx as unknown as { payment: { aggregate: jest.Mock } }).payment.aggregate.mock.calls[0][0];
    expect(call.where.tenantId).toBe("t1");
    expect(call.where.paidAt.gte).toBeInstanceOf(Date);
    expect(call.where.paidAt.gte.getUTCDate()).toBe(1);
  });

  it("returns 0 when no payments were recorded this month", async () => {
    const tx = { payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) } } as unknown as PrismaTx;
    expect(await paymentsCollectedThisMonthMetric.computeLive(context(["payment:read:tenant"]), tx)).toBe(0);
  });

  it("returns 0 and never queries with no payment:read grant", async () => {
    const tx = { payment: { aggregate: jest.fn() } } as unknown as PrismaTx;
    expect(await paymentsCollectedThisMonthMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { payment: { aggregate: jest.Mock } }).payment.aggregate).not.toHaveBeenCalled();
  });
});
