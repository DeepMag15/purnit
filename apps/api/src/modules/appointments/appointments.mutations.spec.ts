import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { appointmentCreateMutation, appointmentUpdateStatusMutation } from "./appointments.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("appointment.create", () => {
  it("requires appointment:create", () => {
    expect(appointmentCreateMutation.requiredPermission).toBe("appointment:create");
  });

  it("creates a real appointment for a real patient and doctor", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a1" });
    const tx = {
      patient: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "d1" }) },
      appointment: { create },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await appointmentCreateMutation.resolve(
      { patientId: "p1", doctorId: "d1", scheduledStart: "2026-08-10T10:00:00Z", scheduledEnd: "2026-08-10T10:30:00Z" },
      context(["appointment:create:tenant"]),
      tx,
    );
    expect(create.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", patientId: "p1", doctorId: "d1", bookedById: "u1" });
  });

  it("throws NotFoundException for a patient that doesn't exist in this tenant", async () => {
    const tx = { patient: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      appointmentCreateMutation.resolve(
        { patientId: "ghost", doctorId: "d1", scheduledStart: "2026-08-10T10:00:00Z", scheduledEnd: "2026-08-10T10:30:00Z" },
        context(["appointment:create:tenant"]),
        tx,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFoundException for a doctor that doesn't exist in this tenant", async () => {
    const tx = {
      patient: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    await expect(
      appointmentCreateMutation.resolve(
        { patientId: "p1", doctorId: "ghost", scheduledStart: "2026-08-10T10:00:00Z", scheduledEnd: "2026-08-10T10:30:00Z" },
        context(["appointment:create:tenant"]),
        tx,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("appointment.updateStatus", () => {
  it("requires appointment:update", () => {
    expect(appointmentUpdateStatusMutation.requiredPermission).toBe("appointment:update");
  });

  it("updates status for an in-scope appointment (own scope, the caller's own)", async () => {
    const tx = {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({ id: "a1", doctorId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "a1", status: "completed" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await appointmentUpdateStatusMutation.resolve({ id: "a1", status: "completed" }, context(["appointment:update:own"]), tx);
    expect((tx as unknown as { appointment: { update: jest.Mock } }).appointment.update.mock.calls[0]![0]).toEqual({
      where: { id: "a1" },
      data: { status: "completed" },
    });
  });

  it("throws ForbiddenException for another doctor's appointment at own scope", async () => {
    const tx = { appointment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", doctorId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(appointmentUpdateStatusMutation.resolve({ id: "a1", status: "completed" }, context(["appointment:update:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("throws NotFoundException for an appointment that doesn't exist in this tenant", async () => {
    const tx = { appointment: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(appointmentUpdateStatusMutation.resolve({ id: "ghost", status: "completed" }, context(["appointment:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});
