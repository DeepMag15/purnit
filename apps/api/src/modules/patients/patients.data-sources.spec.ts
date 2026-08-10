import { collapsePermissions } from "../../rbac/permission-collapse";
import { patientsWhere, patientsListDataSource, patientsDoctorOptionsDataSource } from "./patients.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("patientsWhere", () => {
  it("returns null for an actor with no patient:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await patientsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await patientsWhere(tx, context(["patient:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("collapses own/team/department/department-subtree to 'my assigned patients only' — Patient has no departmentId column", async () => {
    const tx = {} as unknown as PrismaTx;
    for (const scope of ["own", "team", "department", "department-subtree"]) {
      const where = await patientsWhere(tx, context([`patient:read:${scope}`]));
      expect(where).toEqual({ tenantId: "t1", deletedAt: null, assignedDoctorId: "u1" });
    }
  });

  it("layers an extra where clause on top of the scope condition", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await patientsWhere(tx, context(["patient:read:tenant"]), { status: "active" });
    expect(where).toMatchObject({ status: "active" });
  });
});

describe("patients.list", () => {
  it("returns [] when the actor has no patient:read grant", async () => {
    const tx = { patient: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await patientsListDataSource.resolve({}, context([]), tx)).toEqual([]);
    expect((tx as unknown as { patient: { findMany: jest.Mock } }).patient.findMany).not.toHaveBeenCalled();
  });

  it("joins each patient's assignedDoctorName via a two-query join, not a single include", async () => {
    const tx = {
      patient: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: "p1", assignedDoctorId: "d1", chartProjectId: "proj1" },
            { id: "p2", assignedDoctorId: null, chartProjectId: "proj2" },
          ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "d1", displayName: "Dr. Alice" }]) },
    } as unknown as PrismaTx;

    // No project:read grant — withChartVisibility short-circuits before ever
    // touching tx.project, both rows come back chartVisible: false.
    const rows = (await patientsListDataSource.resolve({}, context(["patient:read:tenant"]), tx)) as {
      id: string;
      assignedDoctorName: string | null;
      chartVisible: boolean;
    }[];
    expect(rows).toEqual([
      { id: "p1", assignedDoctorId: "d1", chartProjectId: "proj1", assignedDoctorName: "Dr. Alice", chartVisible: false },
      { id: "p2", assignedDoctorId: null, chartProjectId: "proj2", assignedDoctorName: null, chartVisible: false },
    ]);
  });

  describe("chartVisible", () => {
    it("is true for a patient whose chart Project is within the caller's own project:read scope", async () => {
      const tx = {
        patient: { findMany: jest.fn().mockResolvedValue([{ id: "p1", assignedDoctorId: null, chartProjectId: "proj1" }]) },
        user: { findMany: jest.fn() },
        project: { findMany: jest.fn().mockResolvedValue([{ id: "proj1" }]) },
      } as unknown as PrismaTx;

      const rows = (await patientsListDataSource.resolve(
        {},
        context(["patient:read:tenant", "project:read:tenant"]),
        tx,
      )) as { chartVisible: boolean }[];
      expect(rows[0]!.chartVisible).toBe(true);

      const call = (tx as unknown as { project: { findMany: jest.Mock } }).project.findMany.mock.calls[0]![0];
      expect(call.where).toMatchObject({ tenantId: "t1", id: { in: ["proj1"] } });
    });

    it("is false for a patient whose chart Project the caller cannot see (e.g. Receptionist, no project:read grant at all)", async () => {
      const tx = {
        patient: { findMany: jest.fn().mockResolvedValue([{ id: "p1", assignedDoctorId: null, chartProjectId: "proj1" }]) },
        user: { findMany: jest.fn() },
        project: { findMany: jest.fn() },
      } as unknown as PrismaTx;

      const rows = (await patientsListDataSource.resolve({}, context(["patient:read:tenant"]), tx)) as { chartVisible: boolean }[];
      expect(rows[0]!.chartVisible).toBe(false);
      expect((tx as unknown as { project: { findMany: jest.Mock } }).project.findMany).not.toHaveBeenCalled();
    });
  });
});

describe("patients.doctorOptions", () => {
  it("requires patient:read", () => {
    expect(patientsDoctorOptionsDataSource.requiredPermission).toBe("patient:read");
  });

  it("returns real Users assigned role.doctor, via the standard two-query join (RoleAssignment has no Prisma relation to User)", async () => {
    const tx = {
      roleAssignment: { findMany: jest.fn().mockResolvedValue([{ userId: "d1" }, { userId: "d2" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "d1", displayName: "Dr. Alice" }, { id: "d2", displayName: "Dr. Bob" }]) },
    } as unknown as PrismaTx;

    const rows = await patientsDoctorOptionsDataSource.resolve({}, context(["patient:read:tenant"]), tx);
    expect(rows).toEqual([{ id: "d1", displayName: "Dr. Alice" }, { id: "d2", displayName: "Dr. Bob" }]);
    const call = (tx as unknown as { roleAssignment: { findMany: jest.Mock } }).roleAssignment.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ tenantId: "t1", role: { sourceBlueprintRoleId: "role.doctor" } });
  });

  it("returns [] with no doctors, no crash", async () => {
    const tx = { roleAssignment: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    expect(await patientsDoctorOptionsDataSource.resolve({}, context(["patient:read:tenant"]), tx)).toEqual([]);
  });
});
