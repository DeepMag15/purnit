import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { enrollmentEnrollMutation, enrollmentUpdateStatusMutation, enrollmentRecordFinalGradeMutation } from "./enrollments.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("enrollment.enroll", () => {
  it("requires enrollment:create", () => {
    expect(enrollmentEnrollMutation.requiredPermission).toBe("enrollment:create");
  });

  it("creates an Enrollment row when both the Student and Course exist and no prior enrollment", async () => {
    const create = jest.fn().mockResolvedValue({ id: "e1" });
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: "s1", name: "Ada", userId: null }) },
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Algebra", teacherId: null, materialsProjectId: "mp1" }) },
      enrollment: { findFirst: jest.fn().mockResolvedValue(null), create },
      project: { create: jest.fn().mockResolvedValue({ id: "sp1" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await enrollmentEnrollMutation.resolve({ studentId: "s1", courseId: "c1" }, context(["enrollment:create:tenant"]), tx);
    expect(create.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", studentId: "s1", courseId: "c1", enrolledById: "u1" });
  });

  /** Contextual Reporting — the submissions surface whose absence made
   * "completion means graded" a limitation when the Student role shipped. */
  it("creates a private submissions project owned by the STUDENT, and adds the teacher as a member", async () => {
    const projectCreate = jest.fn().mockResolvedValue({ id: "sp1" });
    const memberCreate = jest.fn();
    const enrollmentCreate = jest.fn().mockResolvedValue({ id: "e1" });
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: "s1", name: "Ada", userId: "studentUser" }) },
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Algebra", teacherId: "teacherUser", materialsProjectId: "mp1" }) },
      enrollment: { findFirst: jest.fn().mockResolvedValue(null), create: enrollmentCreate },
      project: { create: projectCreate },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null), create: memberCreate },
      embeddingJob: { create: jest.fn() },
    } as unknown as PrismaTx;

    await enrollmentEnrollMutation.resolve({ studentId: "s1", courseId: "c1" }, context(["enrollment:create:tenant"]), tx);

    // Ownership, not membership — `projectsWhere` at `own` scope filters on
    // ownerId, and that is the ONLY reason a student can reach their own
    // submissions without any broader project grant.
    expect(projectCreate.mock.calls[0]![0].data).toMatchObject({ ownerId: "studentUser" });
    expect(enrollmentCreate.mock.calls[0]![0].data).toMatchObject({ submissionsProjectId: "sp1" });
    // The teacher marks it, so they are a member of the student's project.
    expect(memberCreate).toHaveBeenCalledWith({ data: { tenantId: "t1", projectId: "sp1", userId: "teacherUser" } });
  });

  it("rejects a duplicate (studentId, courseId) pair instead of silently upserting", async () => {
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      enrollment: { findFirst: jest.fn().mockResolvedValue({ id: "existing" }) },
    } as unknown as PrismaTx;

    await expect(enrollmentEnrollMutation.resolve({ studentId: "s1", courseId: "c1" }, context(["enrollment:create:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws NotFoundException for a nonexistent student or course", async () => {
    const tx = { student: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(enrollmentEnrollMutation.resolve({ studentId: "ghost", courseId: "c1" }, context(["enrollment:create:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("enrollment.updateStatus", () => {
  it("requires enrollment:update", () => {
    expect(enrollmentUpdateStatusMutation.requiredPermission).toBe("enrollment:update");
  });

  it("throws ForbiddenException for an enrollment created by someone else at own scope", async () => {
    const tx = { enrollment: { findFirst: jest.fn().mockResolvedValue({ id: "e1", enrolledById: "someone-else" }) } } as unknown as PrismaTx;
    await expect(enrollmentUpdateStatusMutation.resolve({ id: "e1", status: "dropped" }, context(["enrollment:update:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("updates status for an in-scope enrollment", async () => {
    const tx = {
      enrollment: {
        findFirst: jest.fn().mockResolvedValue({ id: "e1", enrolledById: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "e1", status: "completed" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await enrollmentUpdateStatusMutation.resolve({ id: "e1", status: "completed" }, context(["enrollment:update:own"]), tx);
    expect((tx as unknown as { enrollment: { update: jest.Mock } }).enrollment.update.mock.calls[0]![0]).toEqual({
      where: { id: "e1" },
      data: { status: "completed" },
    });
  });
});

describe("enrollment.recordFinalGrade", () => {
  it("requires enrollment:update", () => {
    expect(enrollmentRecordFinalGradeMutation.requiredPermission).toBe("enrollment:update");
  });

  it("sets finalGrade for an in-scope enrollment", async () => {
    const tx = {
      enrollment: {
        findFirst: jest.fn().mockResolvedValue({ id: "e1", enrolledById: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "e1", finalGrade: "A" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await enrollmentRecordFinalGradeMutation.resolve({ id: "e1", finalGrade: "A" }, context(["enrollment:update:tenant"]), tx);
    expect((tx as unknown as { enrollment: { update: jest.Mock } }).enrollment.update.mock.calls[0]![0]).toEqual({
      where: { id: "e1" },
      data: { finalGrade: "A" },
    });
  });
});
