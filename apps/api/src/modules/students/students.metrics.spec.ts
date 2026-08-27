import { collapsePermissions } from "../../rbac/permission-collapse";
import { studentsTotalCountMetric, studentsStatusBreakdownMetric } from "./students.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("students metrics", () => {
  it("studentsTotalCountMetric requires student:read", () => {
    expect(studentsTotalCountMetric.requiredPermission).toBe("student:read");
  });

  it("studentsTotalCountMetric.computeLive calls through studentsWhere", async () => {
    const tx = { student: { count: jest.fn().mockResolvedValue(7) } } as unknown as PrismaTx;
    const value = await studentsTotalCountMetric.computeLive(context(["student:read:tenant"]), tx);
    expect(value).toBe(7);
    const call = (tx as unknown as { student: { count: jest.Mock } }).student.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1" });
  });

  it("studentsTotalCountMetric.computeLive returns 0 with no student:read grant", async () => {
    const tx = { student: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await studentsTotalCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { student: { count: jest.Mock } }).student.count).not.toHaveBeenCalled();
  });

  it("studentsStatusBreakdownMetric requires student:read and is a breakdown", () => {
    expect(studentsStatusBreakdownMetric.requiredPermission).toBe("student:read");
    expect(studentsStatusBreakdownMetric.kind).toBe("breakdown");
  });

  it("studentsStatusBreakdownMetric.computeLive maps groupBy results to {status, count}", async () => {
    const tx = {
      student: { groupBy: jest.fn().mockResolvedValue([{ status: "active", _count: { _all: 5 } }]) },
    } as unknown as PrismaTx;
    const rows = await studentsStatusBreakdownMetric.computeLive(context(["student:read:tenant"]), tx);
    expect(rows).toEqual([{ status: "active", count: 5 }]);
  });

  it("studentsStatusBreakdownMetric.computeLive returns [] with no grant", async () => {
    const tx = { student: { groupBy: jest.fn() } } as unknown as PrismaTx;
    expect(await studentsStatusBreakdownMetric.computeLive(context([]), tx)).toEqual([]);
    expect((tx as unknown as { student: { groupBy: jest.Mock } }).student.groupBy).not.toHaveBeenCalled();
  });
});
