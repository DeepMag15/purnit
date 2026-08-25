import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { studentRegisterMutation, studentUpdateStatusMutation } from "./students.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("student.register", () => {
  it("requires student:create", () => {
    expect(studentRegisterMutation.requiredPermission).toBe("student:create");
  });

  /** Contextual Reporting (2026-08-25) reversed this. Phase A deliberately
   * gave Student no backing Project — "a per-Student individual document file
   * edges into student-record privacy". It now has one, because a Registrar's
   * paperwork needs somewhere to live; see student.prisma's own comment for
   * the privacy caveat that remains open. */
  it("creates a Student row with its own files Project, so a Registrar has somewhere to file paperwork", async () => {
    const studentCreate = jest.fn().mockResolvedValue({ id: "s1" });
    const projectCreate = jest.fn().mockResolvedValue({ id: "p1" });
    const tx = {
      student: { create: studentCreate },
      project: { create: projectCreate },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await studentRegisterMutation.resolve({ name: "Jane Doe" }, context(["student:create:tenant"]), tx);

    expect(projectCreate.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", name: "Student file: Jane Doe" });
    expect(studentCreate.mock.calls[0]![0].data).toMatchObject({
      tenantId: "t1",
      name: "Jane Doe",
      registeredById: "u1",
      filesProjectId: "p1",
    });
  });
});

describe("student.updateStatus", () => {
  it("requires student:update", () => {
    expect(studentUpdateStatusMutation.requiredPermission).toBe("student:update");
  });

  it("updates status for an in-scope student (own scope, registered by the caller)", async () => {
    const tx = {
      student: {
        findFirst: jest.fn().mockResolvedValue({ id: "s1", registeredById: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "s1", status: "graduated" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await studentUpdateStatusMutation.resolve({ id: "s1", status: "graduated" }, context(["student:update:own"]), tx);
    expect((tx as unknown as { student: { update: jest.Mock } }).student.update.mock.calls[0]![0]).toEqual({
      where: { id: "s1" },
      data: { status: "graduated" },
    });
  });

  it("throws ForbiddenException for a student registered by someone else at own scope", async () => {
    const tx = { student: { findFirst: jest.fn().mockResolvedValue({ id: "s1", registeredById: "someone-else" }) } } as unknown as PrismaTx;
    await expect(studentUpdateStatusMutation.resolve({ id: "s1", status: "graduated" }, context(["student:update:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("throws NotFoundException for a student that doesn't exist in this tenant", async () => {
    const tx = { student: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(studentUpdateStatusMutation.resolve({ id: "ghost", status: "graduated" }, context(["student:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});
