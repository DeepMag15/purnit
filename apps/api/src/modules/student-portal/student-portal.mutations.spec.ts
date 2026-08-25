import { BadRequestException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { studentLinkLoginMutation } from "./student-portal.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = ["student:update:tenant"]): MutationContext {
  return { tenantId: "t1", userId: "registrar1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

function txWith(over: Record<string, unknown> = {}) {
  return {
    student: {
      findFirst: jest.fn().mockResolvedValue({ id: "s1", name: "Ada", userId: null }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "s1", ...data })),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
    enrollment: { findMany: jest.fn().mockResolvedValue([]) },
    course: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    auditLog: { create: jest.fn() },
    ...over,
  } as unknown as PrismaTx;
}

describe("student.linkLogin", () => {
  it("is gated on student:update — authority over the student record, not user management", () => {
    expect(studentLinkLoginMutation.requiredPermission).toBe("student:update");
  });

  it("404s for a student in another tenant exactly as for one that doesn't exist", async () => {
    const tx = txWith({ student: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(studentLinkLoginMutation.resolve({ studentId: "s9", userId: "u1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("404s for a user id from another tenant", async () => {
    const tx = txWith({ user: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(studentLinkLoginMutation.resolve({ studentId: "s1", userId: "u9" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("refuses a login already linked to a different student, naming who holds it", async () => {
    // A fresh tx per call — `mockResolvedValueOnce` chains are consumed, so
    // reusing one would have the second assertion testing a different path.
    const taken = () =>
      txWith({
        student: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: "s1", name: "Ada", userId: null }) // the target
            .mockResolvedValueOnce({ id: "s2", name: "Grace", userId: "u1" }), // already taken
          update: jest.fn(),
        },
      });
    // The unique index would reject this anyway, but as a raw 500 that tells
    // the registrar nothing about which record already holds the login.
    await expect(studentLinkLoginMutation.resolve({ studentId: "s1", userId: "u1" }, context(), taken())).rejects.toThrow(BadRequestException);
    await expect(studentLinkLoginMutation.resolve({ studentId: "s1", userId: "u1" }, context(), taken())).rejects.toThrow(/Grace/);
  });

  it("backfills materials access for courses the student was already enrolled in", async () => {
    const tx = txWith({
      student: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: "s1", name: "Ada", userId: null }).mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ id: "s1", userId: "u1" }),
      },
      enrollment: { findMany: jest.fn().mockResolvedValue([{ courseId: "c1" }, { courseId: "c2" }]) },
      course: { findMany: jest.fn().mockResolvedValue([{ materialsProjectId: "p1" }, { materialsProjectId: "p2" }]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ projectId: "p1" }]), create: jest.fn() },
    });

    await studentLinkLoginMutation.resolve({ studentId: "s1", userId: "u1" }, context(), tx);

    const create = (tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create;
    // p1 already had a membership row; only the missing one is created.
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: { tenantId: "t1", projectId: "p2", userId: "u1" } });
  });

  it("unlinks without touching memberships when userId is null", async () => {
    const tx = txWith();
    await studentLinkLoginMutation.resolve({ studentId: "s1", userId: null }, context(), tx);

    expect((tx as unknown as { student: { update: jest.Mock } }).student.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { userId: null },
    });
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create).not.toHaveBeenCalled();
  });
});
