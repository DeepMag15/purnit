import { collapsePermissions } from "../../rbac/permission-collapse";
import { appointmentsWhere, appointmentsListDataSource } from "./appointments.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("appointmentsWhere", () => {
  it("returns null for an actor with no appointment:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await appointmentsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await appointmentsWhere(tx, context(["appointment:read:tenant"]))).toEqual({ tenantId: "t1" });
  });

  it("collapses own/team/department/department-subtree to 'my own appointments only' — Appointment has no departmentId column", async () => {
    const tx = {} as unknown as PrismaTx;
    for (const scope of ["own", "team", "department", "department-subtree"]) {
      expect(await appointmentsWhere(tx, context([`appointment:read:${scope}`]))).toEqual({ tenantId: "t1", doctorId: "u1" });
    }
  });
});

describe("appointments.list", () => {
  it("returns [] when the actor has no appointment:read grant", async () => {
    const tx = { appointment: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await appointmentsListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });

  it("joins each appointment's doctorName via a two-query join, includes patient name via the real Prisma relation", async () => {
    const tx = {
      appointment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "a1",
            patientId: "p1",
            patient: { id: "p1", name: "Jane Doe" },
            doctorId: "d1",
            scheduledStart: new Date("2026-08-10T10:00:00Z"),
            scheduledEnd: new Date("2026-08-10T10:30:00Z"),
            status: "scheduled",
            notes: null,
          },
        ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "d1", displayName: "Dr. Alice" }]) },
    } as unknown as PrismaTx;

    const rows = (await appointmentsListDataSource.resolve({}, context(["appointment:read:tenant"]), tx)) as { patientName: string; doctorName: string }[];
    expect(rows).toEqual([
      expect.objectContaining({ patientName: "Jane Doe", doctorName: "Dr. Alice" }),
    ]);
  });

  it("layers a patientId filter onto the scope condition", async () => {
    const tx = { appointment: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    await appointmentsListDataSource.resolve({ patientId: "p1" }, context(["appointment:read:tenant"]), tx);
    const call = (tx as unknown as { appointment: { findMany: jest.Mock } }).appointment.findMany.mock.calls[0]![0];
    expect(call.where).toMatchObject({ patientId: "p1" });
  });
});
