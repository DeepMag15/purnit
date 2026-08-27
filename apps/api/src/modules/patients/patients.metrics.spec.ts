import { collapsePermissions } from "../../rbac/permission-collapse";
import { patientsTotalCountMetric, patientsStatusBreakdownMetric, doctorsActiveCountMetric } from "./patients.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("patients metrics", () => {
  it("patientsTotalCountMetric requires patient:read", () => {
    expect(patientsTotalCountMetric.requiredPermission).toBe("patient:read");
  });

  it("patientsTotalCountMetric.computeLive calls through patientsWhere", async () => {
    const tx = { patient: { count: jest.fn().mockResolvedValue(4) } } as unknown as PrismaTx;
    const value = await patientsTotalCountMetric.computeLive(context(["patient:read:tenant"]), tx);
    expect(value).toBe(4);
    const call = (tx as unknown as { patient: { count: jest.Mock } }).patient.count.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1" });
  });

  it("patientsTotalCountMetric.computeLive returns 0 when the actor has no patient:read grant at all", async () => {
    const tx = { patient: { count: jest.fn() } } as unknown as PrismaTx;
    expect(await patientsTotalCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { patient: { count: jest.Mock } }).patient.count).not.toHaveBeenCalled();
  });

  it("patientsStatusBreakdownMetric requires patient:read and has no snapshot", () => {
    expect(patientsStatusBreakdownMetric.requiredPermission).toBe("patient:read");
    expect(patientsStatusBreakdownMetric.kind).toBe("breakdown");
  });

  it("patientsStatusBreakdownMetric.computeLive maps groupBy results to {status, count}", async () => {
    const tx = {
      patient: { groupBy: jest.fn().mockResolvedValue([{ status: "active", _count: { _all: 3 } }]) },
    } as unknown as PrismaTx;
    const rows = await patientsStatusBreakdownMetric.computeLive(context(["patient:read:tenant"]), tx);
    expect(rows).toEqual([{ status: "active", count: 3 }]);
  });

  it("patientsStatusBreakdownMetric.computeLive returns [] with no grant", async () => {
    const tx = { patient: { groupBy: jest.fn() } } as unknown as PrismaTx;
    expect(await patientsStatusBreakdownMetric.computeLive(context([]), tx)).toEqual([]);
    expect((tx as unknown as { patient: { groupBy: jest.Mock } }).patient.groupBy).not.toHaveBeenCalled();
  });

  describe("doctorsActiveCountMetric", () => {
    it("requires patient:read", () => {
      expect(doctorsActiveCountMetric.requiredPermission).toBe("patient:read");
    });

    it("returns 0 and never queries when the actor has no patient:read grant at all", async () => {
      const tx = { roleAssignment: { findMany: jest.fn() }, user: { count: jest.fn() } } as unknown as PrismaTx;
      expect(await doctorsActiveCountMetric.computeLive(context([]), tx)).toBe(0);
      expect((tx as unknown as { roleAssignment: { findMany: jest.Mock } }).roleAssignment.findMany).not.toHaveBeenCalled();
    });

    it("joins role assignments by sourceBlueprintRoleId=role.doctor, dedupes users, counts active ones", async () => {
      const tx = {
        roleAssignment: {
          findMany: jest.fn().mockResolvedValue([{ userId: "d1" }, { userId: "d2" }, { userId: "d1" }]),
        },
        user: { count: jest.fn().mockResolvedValue(2) },
      } as unknown as PrismaTx;

      const value = await doctorsActiveCountMetric.computeLive(context(["patient:read:tenant"]), tx);
      expect(value).toBe(2);

      const findManyCall = (tx as unknown as { roleAssignment: { findMany: jest.Mock } }).roleAssignment.findMany.mock.calls[0][0];
      expect(findManyCall.where).toMatchObject({ tenantId: "t1", role: { sourceBlueprintRoleId: "role.doctor" } });

      const countCall = (tx as unknown as { user: { count: jest.Mock } }).user.count.mock.calls[0][0];
      expect(countCall.where).toMatchObject({ id: { in: ["d1", "d2"] }, tenantId: "t1", status: "active", deletedAt: null });
    });

    it("returns 0 without querying User when no role.doctor assignments exist", async () => {
      const tx = {
        roleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
        user: { count: jest.fn() },
      } as unknown as PrismaTx;
      expect(await doctorsActiveCountMetric.computeLive(context(["patient:read:tenant"]), tx)).toBe(0);
      expect((tx as unknown as { user: { count: jest.Mock } }).user.count).not.toHaveBeenCalled();
    });
  });
});
