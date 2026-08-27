import { collapsePermissions } from "../../rbac/permission-collapse";
import { enrollmentsActiveCountMetric } from "./enrollments.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("enrollments metrics", () => {
  it("enrollmentsActiveCountMetric requires enrollment:read", () => {
    expect(enrollmentsActiveCountMetric.requiredPermission).toBe("enrollment:read");
  });

  it("enrollmentsActiveCountMetric.computeLive filters on status: enrolled via enrollmentsWhere", async () => {
    const tx = { enrollment: { count: jest.fn().mockResolvedValue(9) } } as unknown as PrismaTx;
    const value = await enrollmentsActiveCountMetric.computeLive(context(["enrollment:read:tenant"]), tx);
    expect(value).toBe(9);
    const call = (tx as unknown as { enrollment: { count: jest.Mock } }).enrollment.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", status: "enrolled" });
  });

  it("enrollmentsActiveCountMetric.computeLive returns 0 with no enrollment:read grant (e.g. Teacher/TA)", async () => {
    const tx = { enrollment: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await enrollmentsActiveCountMetric.computeLive(context(["assignment:read:own"]), tx)).toBe(0);
    expect((tx as unknown as { enrollment: { count: jest.Mock } }).enrollment.count).not.toHaveBeenCalled();
  });
});
