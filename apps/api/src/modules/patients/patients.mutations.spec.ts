import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { patientRegisterMutation, patientUpdateStatusMutation, patientAssignDoctorMutation } from "./patients.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("patient.register", () => {
  it("requires patient:create", () => {
    expect(patientRegisterMutation.requiredPermission).toBe("patient:create");
  });

  it("creates the chart Project first, then the Patient row pointing at it", async () => {
    const projectCreate = jest.fn().mockResolvedValue({ id: "proj1" });
    const patientCreate = jest.fn().mockResolvedValue({ id: "pat1", chartProjectId: "proj1" });
    const tx = {
      project: { create: projectCreate },
      patient: { create: patientCreate },
      user: { findFirst: jest.fn() },
      projectMember: { create: jest.fn() },
    } as unknown as PrismaTx;

    await patientRegisterMutation.resolve({ name: "Jane Doe" }, context(["patient:create:tenant"]), tx);

    expect(projectCreate).toHaveBeenCalledTimes(1);
    expect(projectCreate.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", name: "Chart: Jane Doe", ownerId: "u1" });
    expect(patientCreate.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", chartProjectId: "proj1", name: "Jane Doe", registeredById: "u1" });
  });

  it("adds the assigned doctor as a chart ProjectMember when one is given", async () => {
    const tx = {
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      patient: { create: jest.fn().mockResolvedValue({ id: "pat1" }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "doc1" }) },
      projectMember: { create: jest.fn() },
    } as unknown as PrismaTx;

    await patientRegisterMutation.resolve({ name: "Jane Doe", assignedDoctorId: "doc1" }, context(["patient:create:tenant"]), tx);

    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create.mock.calls[0]![0].data).toMatchObject({
      tenantId: "t1",
      projectId: "proj1",
      userId: "doc1",
    });
  });

  it("throws NotFoundException when assignedDoctorId doesn't resolve to a real User in this tenant", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(patientRegisterMutation.resolve({ name: "Jane Doe", assignedDoctorId: "ghost" }, context(["patient:create:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("does not create a ProjectMember row when no doctor is assigned", async () => {
    const projectMemberCreate = jest.fn();
    const tx = {
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      patient: { create: jest.fn().mockResolvedValue({ id: "pat1" }) },
      projectMember: { create: projectMemberCreate },
    } as unknown as PrismaTx;

    await patientRegisterMutation.resolve({ name: "Jane Doe" }, context(["patient:create:tenant"]), tx);
    expect(projectMemberCreate).not.toHaveBeenCalled();
  });
});

describe("patient.updateStatus", () => {
  it("requires patient:update", () => {
    expect(patientUpdateStatusMutation.requiredPermission).toBe("patient:update");
  });

  it("updates status for an in-scope patient (own scope, assigned to the caller)", async () => {
    const tx = {
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: "pat1", assignedDoctorId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "pat1", status: "admitted" }),
      },
    } as unknown as PrismaTx;

    await patientUpdateStatusMutation.resolve({ id: "pat1", status: "admitted" }, context(["patient:update:own"]), tx);
    expect((tx as unknown as { patient: { update: jest.Mock } }).patient.update.mock.calls[0]![0]).toEqual({
      where: { id: "pat1" },
      data: { status: "admitted" },
    });
  });

  it("throws ForbiddenException for a patient assigned to a different doctor at own scope", async () => {
    const tx = {
      patient: { findFirst: jest.fn().mockResolvedValue({ id: "pat1", assignedDoctorId: "someone-else" }) },
    } as unknown as PrismaTx;

    await expect(patientUpdateStatusMutation.resolve({ id: "pat1", status: "admitted" }, context(["patient:update:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("throws NotFoundException for a patient that doesn't exist in this tenant", async () => {
    const tx = { patient: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(patientUpdateStatusMutation.resolve({ id: "ghost", status: "admitted" }, context(["patient:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("patient.assignDoctor", () => {
  it("requires patient:update", () => {
    expect(patientAssignDoctorMutation.requiredPermission).toBe("patient:update");
  });

  it("updates assignedDoctorId and adds the doctor as a chart ProjectMember", async () => {
    const tx = {
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: "pat1", assignedDoctorId: null, chartProjectId: "proj1" }),
        update: jest.fn().mockResolvedValue({ id: "pat1", assignedDoctorId: "doc1" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "doc1" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    } as unknown as PrismaTx;

    await patientAssignDoctorMutation.resolve({ id: "pat1", doctorId: "doc1" }, context(["patient:update:tenant"]), tx);

    expect((tx as unknown as { patient: { update: jest.Mock } }).patient.update.mock.calls[0]![0].data).toEqual({ assignedDoctorId: "doc1" });
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create.mock.calls[0]![0].data).toMatchObject({
      projectId: "proj1",
      userId: "doc1",
    });
  });

  it("is idempotent — does not create a duplicate ProjectMember if the doctor is already a member", async () => {
    const tx = {
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: "pat1", assignedDoctorId: null, chartProjectId: "proj1" }),
        update: jest.fn().mockResolvedValue({ id: "pat1" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "doc1" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "existing-member" }), create: jest.fn() },
    } as unknown as PrismaTx;

    await patientAssignDoctorMutation.resolve({ id: "pat1", doctorId: "doc1" }, context(["patient:update:tenant"]), tx);
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when doctorId doesn't resolve to a real User", async () => {
    const tx = {
      patient: { findFirst: jest.fn().mockResolvedValue({ id: "pat1", assignedDoctorId: null, chartProjectId: "proj1" }) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;

    await expect(patientAssignDoctorMutation.resolve({ id: "pat1", doctorId: "ghost" }, context(["patient:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});
