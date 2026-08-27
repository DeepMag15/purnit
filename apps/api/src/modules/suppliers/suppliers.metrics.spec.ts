import { collapsePermissions } from "../../rbac/permission-collapse";
import { suppliersTotalCountMetric } from "./suppliers.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("suppliersTotalCountMetric", () => {
  it("requires supplier:read", () => {
    expect(suppliersTotalCountMetric.requiredPermission).toBe("supplier:read");
  });

  it("returns 0 and never queries with no supplier:read grant", async () => {
    const tx = { supplier: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await suppliersTotalCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { supplier: { count: jest.Mock } }).supplier.count).not.toHaveBeenCalled();
  });

  it("counts suppliers in scope", async () => {
    const tx = { supplier: { count: jest.fn().mockResolvedValue(4) } } as unknown as PrismaTx;
    const value = await suppliersTotalCountMetric.computeLive(context(["supplier:read:tenant"]), tx);
    expect(value).toBe(4);
  });
});
