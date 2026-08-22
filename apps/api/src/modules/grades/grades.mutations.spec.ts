import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { gradeRecordMutation, gradeUpdateMutation } from "./grades.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("grade.record", () => {
  it("requires grade:create", () => {
    expect(gradeRecordMutation.requiredPermission).toBe("grade:create");
  });

  it("creates the first Grade for an (assignment, student) pair, stamping gradedById/gradedAt to the caller", async () => {
    const create = jest.fn().mockResolvedValue({ id: "g1" });
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1", maxScore: 100 }) },
      enrollment: { findFirst: jest.fn().mockResolvedValue({ id: "e1", status: "enrolled" }) },
      grade: { findFirst: jest.fn().mockResolvedValue(null), create },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await gradeRecordMutation.resolve({ assignmentId: "a1", studentId: "s1", score: 90 }, context(["grade:create:tenant"]), tx);
    expect(create.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", assignmentId: "a1", studentId: "s1", score: 90, gradedById: "u1" });
    expect(create.mock.calls[0]![0].data.gradedAt).toBeInstanceOf(Date);
  });

  it("resolves scope transitively through Course -> Assignment (own scope) — succeeds for the teacher's own course", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1", maxScore: 100 }) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
      enrollment: { findFirst: jest.fn().mockResolvedValue({ id: "e1", status: "enrolled" }) },
      grade: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "g1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await expect(
      gradeRecordMutation.resolve({ assignmentId: "a1", studentId: "s1", score: 90 }, context(["grade:create:own"]), tx),
    ).resolves.toMatchObject({ id: "g1" });
  });

  it("rejects grading an assignment under a course the actor does NOT teach, at own scope", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1", maxScore: 100 }) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "some-other-course" }]) },
    } as unknown as PrismaTx;

    await expect(gradeRecordMutation.resolve({ assignmentId: "a1", studentId: "s1", score: 90 }, context(["grade:create:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects a score exceeding the assignment's maxScore", async () => {
    const tx = { assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1", maxScore: 50 }) } } as unknown as PrismaTx;
    await expect(gradeRecordMutation.resolve({ assignmentId: "a1", studentId: "s1", score: 90 }, context(["grade:create:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects grading a student who isn't actively enrolled in the course", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1", maxScore: 100 }) },
      enrollment: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;

    await expect(gradeRecordMutation.resolve({ assignmentId: "a1", studentId: "s1", score: 90 }, context(["grade:create:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects a duplicate grade for the same (assignment, student) pair — directs to grade.update instead", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1", maxScore: 100 }) },
      enrollment: { findFirst: jest.fn().mockResolvedValue({ id: "e1", status: "enrolled" }) },
      grade: { findFirst: jest.fn().mockResolvedValue({ id: "existing-grade" }) },
    } as unknown as PrismaTx;

    await expect(gradeRecordMutation.resolve({ assignmentId: "a1", studentId: "s1", score: 90 }, context(["grade:create:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe("grade.update", () => {
  it("requires grade:update", () => {
    expect(gradeUpdateMutation.requiredPermission).toBe("grade:update");
  });

  it("succeeds for the grader's own already-graded row (own scope) — the literal isRowInScope-on-gradedById mirror of appointment.updateStatus", async () => {
    const update = jest.fn().mockResolvedValue({ id: "g1", score: 95 });
    const tx = {
      grade: { findFirst: jest.fn().mockResolvedValue({ id: "g1", assignmentId: "a1", gradedById: "u1" }), update },
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", maxScore: 100 }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await gradeUpdateMutation.resolve({ id: "g1", score: 95 }, context(["grade:update:own"]), tx);
    expect(update.mock.calls[0]![0].data).toMatchObject({ score: 95, gradedById: "u1" });
  });

  it("throws ForbiddenException when a DIFFERENT grader tries to correct the row at own scope", async () => {
    const tx = { grade: { findFirst: jest.fn().mockResolvedValue({ id: "g1", assignmentId: "a1", gradedById: "original-grader" }) } } as unknown as PrismaTx;

    await expect(gradeUpdateMutation.resolve({ id: "g1", score: 95 }, context(["grade:update:own"], "second-teacher"), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("throws NotFoundException for a grade that doesn't exist", async () => {
    const tx = { grade: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(gradeUpdateMutation.resolve({ id: "ghost", score: 95 }, context(["grade:update:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });

  it("rejects a corrected score exceeding the assignment's maxScore", async () => {
    const tx = {
      grade: { findFirst: jest.fn().mockResolvedValue({ id: "g1", assignmentId: "a1", gradedById: "u1" }) },
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", maxScore: 50 }) },
    } as unknown as PrismaTx;

    await expect(gradeUpdateMutation.resolve({ id: "g1", score: 90 }, context(["grade:update:own"]), tx)).rejects.toThrow(BadRequestException);
  });
});
