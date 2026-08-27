import { collapsePermissions } from "../../rbac/permission-collapse";
import { appointmentsTodayCountMetric, appointmentsCompletedCountMetric } from "./appointments.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("appointments metrics", () => {
  describe("appointmentsTodayCountMetric", () => {
    it("requires appointment:read", () => {
      expect(appointmentsTodayCountMetric.requiredPermission).toBe("appointment:read");
    });

    it("computeLive passes UTC day-boundary scheduledStart range to appointmentsWhere", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-15T14:30:00.000Z"));
      const tx = { appointment: { count: jest.fn().mockResolvedValue(2) } } as unknown as PrismaTx;
      const value = await appointmentsTodayCountMetric.computeLive(context(["appointment:read:tenant"]), tx);
      expect(value).toBe(2);
      const call = (tx as unknown as { appointment: { count: jest.Mock } }).appointment.count.mock.calls[0][0];
      expect(call.where).toMatchObject({
        tenantId: "t1",
        scheduledStart: { gte: new Date("2026-08-15T00:00:00.000Z"), lte: new Date("2026-08-15T23:59:59.999Z") },
      });
      jest.useRealTimers();
    });

    it("returns 0 when the actor has no appointment:read grant at all", async () => {
      const tx = { appointment: { count: jest.fn() } } as unknown as PrismaTx;
      expect(await appointmentsTodayCountMetric.computeLive(context([]), tx)).toBe(0);
      expect((tx as unknown as { appointment: { count: jest.Mock } }).appointment.count).not.toHaveBeenCalled();
    });
  });

  describe("appointmentsCompletedCountMetric", () => {
    it("requires appointment:read", () => {
      expect(appointmentsCompletedCountMetric.requiredPermission).toBe("appointment:read");
    });

    it("computeLive passes status: completed to appointmentsWhere", async () => {
      const tx = { appointment: { count: jest.fn().mockResolvedValue(5) } } as unknown as PrismaTx;
      const value = await appointmentsCompletedCountMetric.computeLive(context(["appointment:read:tenant"]), tx);
      expect(value).toBe(5);
      const call = (tx as unknown as { appointment: { count: jest.Mock } }).appointment.count.mock.calls[0][0];
      expect(call.where).toMatchObject({ tenantId: "t1", status: "completed" });
    });

    it("returns 0 when the actor has no appointment:read grant at all", async () => {
      const tx = { appointment: { count: jest.fn() } } as unknown as PrismaTx;
      expect(await appointmentsCompletedCountMetric.computeLive(context([]), tx)).toBe(0);
      expect((tx as unknown as { appointment: { count: jest.Mock } }).appointment.count).not.toHaveBeenCalled();
    });
  });
});
