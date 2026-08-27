import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { courseCreateMutation, courseUpdateStatusMutation, courseAssignTeacherMutation } from "./courses.mutations";
import type { MutationContext } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): MutationContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("course.create", () => {
  it("requires course:create", () => {
    expect(courseCreateMutation.requiredPermission).toBe("course:create");
  });

  it("creates the materials Project first, then the Course row pointing at it", async () => {
    const projectCreate = jest.fn().mockResolvedValue({ id: "proj1" });
    const courseCreate = jest.fn().mockResolvedValue({ id: "c1", materialsProjectId: "proj1" });
    const tx = {
      project: { create: projectCreate },
      course: { create: courseCreate },
      user: { findFirst: jest.fn() },
      projectMember: { create: jest.fn() },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await courseCreateMutation.resolve({ name: "Algebra" }, context(["course:create:tenant"]), tx);

    expect(projectCreate.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", name: "Materials: Algebra", ownerId: "u1" });
    expect(courseCreate.mock.calls[0]![0].data).toMatchObject({ tenantId: "t1", materialsProjectId: "proj1", name: "Algebra" });
  });

  it("adds the assigned teacher as a materialsProject ProjectMember when one is given", async () => {
    const tx = {
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      course: { create: jest.fn().mockResolvedValue({ id: "c1" }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "teach1" }) },
      projectMember: { create: jest.fn() },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await courseCreateMutation.resolve({ name: "Algebra", teacherId: "teach1" }, context(["course:create:tenant"]), tx);

    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create.mock.calls[0]![0].data).toMatchObject({
      projectId: "proj1",
      userId: "teach1",
    });
  });

  it("throws NotFoundException when teacherId doesn't resolve to a real User in this tenant", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(courseCreateMutation.resolve({ name: "Algebra", teacherId: "ghost" }, context(["course:create:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("does not create a ProjectMember row when no teacher is assigned", async () => {
    const projectMemberCreate = jest.fn();
    const tx = {
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      course: { create: jest.fn().mockResolvedValue({ id: "c1" }) },
      projectMember: { create: projectMemberCreate },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await courseCreateMutation.resolve({ name: "Algebra" }, context(["course:create:tenant"]), tx);
    expect(projectMemberCreate).not.toHaveBeenCalled();
  });
});

describe("course.updateStatus", () => {
  it("requires course:update", () => {
    expect(courseUpdateStatusMutation.requiredPermission).toBe("course:update");
  });

  it("updates status for an in-scope course (own scope, taught by the caller)", async () => {
    const tx = {
      course: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", teacherId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "c1", status: "archived" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await courseUpdateStatusMutation.resolve({ id: "c1", status: "archived" }, context(["course:update:own"]), tx);
    expect((tx as unknown as { course: { update: jest.Mock } }).course.update.mock.calls[0]![0]).toEqual({
      where: { id: "c1" },
      data: { status: "archived" },
    });
  });

  it("throws ForbiddenException for a course taught by a different teacher at own scope", async () => {
    const tx = { course: { findFirst: jest.fn().mockResolvedValue({ id: "c1", teacherId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(courseUpdateStatusMutation.resolve({ id: "c1", status: "archived" }, context(["course:update:own"]), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe("course.assignTeacher", () => {
  it("requires course:update", () => {
    expect(courseAssignTeacherMutation.requiredPermission).toBe("course:update");
  });

  it("updates teacherId and adds the teacher as a materialsProject ProjectMember", async () => {
    const tx = {
      course: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", teacherId: null, materialsProjectId: "proj1" }),
        update: jest.fn().mockResolvedValue({ id: "c1", teacherId: "teach1" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "teach1" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    } as unknown as PrismaTx;

    await courseAssignTeacherMutation.resolve({ id: "c1", teacherId: "teach1" }, context(["course:update:tenant"]), tx);

    expect((tx as unknown as { course: { update: jest.Mock } }).course.update.mock.calls[0]![0].data).toEqual({ teacherId: "teach1" });
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create.mock.calls[0]![0].data).toMatchObject({
      projectId: "proj1",
      userId: "teach1",
    });
  });

  it("is idempotent — does not create a duplicate ProjectMember if the teacher is already a member", async () => {
    const tx = {
      course: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", teacherId: null, materialsProjectId: "proj1" }),
        update: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "teach1" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "existing-member" }), create: jest.fn() },
    } as unknown as PrismaTx;

    await courseAssignTeacherMutation.resolve({ id: "c1", teacherId: "teach1" }, context(["course:update:tenant"]), tx);
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create).not.toHaveBeenCalled();
  });
});
