import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { requireAssignmentInScope, assignmentCreateMutation, assignmentUpdateMutation } from "./assignments.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("requireAssignmentInScope", () => {
  it("throws NotFoundException for an assignment that doesn't exist", async () => {
    const tx = { assignment: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      requireAssignmentInScope(tx, context(["assignment:update:tenant"]), "ghost", { resource: "assignment", action: "update" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("passes at tenant scope without ever consulting teacherOwnedCourseIds", async () => {
    const courseFindMany = jest.fn();
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1" }) },
      course: { findMany: courseFindMany },
    } as unknown as PrismaTx;

    const assignment = await requireAssignmentInScope(tx, context(["assignment:update:tenant"]), "a1", { resource: "assignment", action: "update" });
    expect(assignment).toMatchObject({ id: "a1" });
    expect(courseFindMany).not.toHaveBeenCalled();
  });

  it("passes at own scope when the assignment's course is in teacherOwnedCourseIds", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1" }) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
    } as unknown as PrismaTx;

    const assignment = await requireAssignmentInScope(tx, context(["assignment:update:own"]), "a1", { resource: "assignment", action: "update" });
    expect(assignment).toMatchObject({ id: "a1" });
  });

  it("throws ForbiddenException at own scope when the assignment's course is NOT taught by the actor", async () => {
    const tx = {
      assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1" }) },
      course: { findMany: jest.fn().mockResolvedValue([{ id: "c2" }]) },
    } as unknown as PrismaTx;

    await expect(
      requireAssignmentInScope(tx, context(["assignment:update:own"]), "a1", { resource: "assignment", action: "update" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("throws ForbiddenException when the actor holds no grant for the given permission at all", async () => {
    const tx = { assignment: { findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1" }) } } as unknown as PrismaTx;
    await expect(requireAssignmentInScope(tx, context([]), "a1", { resource: "assignment", action: "update" })).rejects.toThrow(ForbiddenException);
  });
});

describe("assignment.create", () => {
  it("requires assignment:create", () => {
    expect(assignmentCreateMutation.requiredPermission).toBe("assignment:create");
  });

  it("creates an Assignment for a course the actor teaches (own scope)", async () => {
    const create = jest.fn().mockResolvedValue({ id: "a1" });
    const tx = {
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }), findMany: jest.fn().mockResolvedValue([{ id: "c1" }]) },
      assignment: { create },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await assignmentCreateMutation.resolve({ courseId: "c1", title: "Homework 1" }, context(["assignment:create:own"]), tx);
    expect(create.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", courseId: "c1", title: "Homework 1", maxScore: 100, createdById: "u1" });
  });

  it("rejects creating an assignment for a course the actor does NOT teach, at own scope", async () => {
    const tx = {
      course: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }), findMany: jest.fn().mockResolvedValue([{ id: "some-other-course" }]) },
    } as unknown as PrismaTx;

    await expect(
      assignmentCreateMutation.resolve({ courseId: "c1", title: "Homework 1" }, context(["assignment:create:own"]), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("throws NotFoundException for a nonexistent course", async () => {
    const tx = { course: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assignmentCreateMutation.resolve({ courseId: "ghost", title: "Homework 1" }, context(["assignment:create:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("assignment.update", () => {
  it("requires assignment:update", () => {
    expect(assignmentUpdateMutation.requiredPermission).toBe("assignment:update");
  });

  it("updates fields for an in-scope assignment", async () => {
    const tx = {
      assignment: {
        findFirst: jest.fn().mockResolvedValue({ id: "a1", courseId: "c1" }),
        update: jest.fn().mockResolvedValue({ id: "a1", title: "Updated" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await assignmentUpdateMutation.resolve({ id: "a1", title: "Updated" }, context(["assignment:update:tenant"]), tx);
    expect((tx as unknown as { assignment: { update: jest.Mock } }).assignment.update.mock.calls[0]![0].data).toMatchObject({ title: "Updated" });
  });
});
