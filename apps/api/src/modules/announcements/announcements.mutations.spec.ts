import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { announcementCreateMutation, announcementDeleteMutation } from "./announcements.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("announcement.create — input validation", () => {
  it("rejects an empty title", () => {
    const result = announcementCreateMutation.inputSchema.safeParse({ title: "", body: "hello" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty body", () => {
    const result = announcementCreateMutation.inputSchema.safeParse({ title: "hi", body: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid input with no departmentId (tenant-wide intent)", () => {
    const result = announcementCreateMutation.inputSchema.safeParse({ title: "hi", body: "hello" });
    expect(result.success).toBe(true);
  });
});

describe("announcement.create — authorization", () => {
  it("throws ForbiddenException when the actor has no announcement:create grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(announcementCreateMutation.resolve({ title: "x", body: "y" }, context([]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("a department-scoped actor (Department Head) can post to their own department", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "d1" }]),
      announcement: { create: jest.fn().mockResolvedValue({ id: "a1", title: "x" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await announcementCreateMutation.resolve({ title: "x", body: "y", departmentId: "d1" }, context(["announcement:create:department"], "d1"), tx);

    expect((tx as unknown as { announcement: { create: jest.Mock } }).announcement.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", authorId: "u1", departmentId: "d1", title: "x", body: "y" },
    });
  });

  it("a department-scoped actor is rejected posting to a different (sibling) department", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(
      announcementCreateMutation.resolve({ title: "x", body: "y", departmentId: "sibling" }, context(["announcement:create:department"], "d1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("a department-scoped actor is rejected posting tenant-wide (no departmentId)", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(announcementCreateMutation.resolve({ title: "x", body: "y" }, context(["announcement:create:department"], "d1"), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("a department-subtree-scoped actor (Executive) can post to a department within their subtree", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]),
      announcement: { create: jest.fn().mockResolvedValue({ id: "a1", title: "x" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await announcementCreateMutation.resolve(
      { title: "x", body: "y", departmentId: "grandchild" },
      context(["announcement:create:department-subtree"], "root"),
      tx,
    );

    expect((tx as unknown as { announcement: { create: jest.Mock } }).announcement.create).toHaveBeenCalled();
  });

  it("a department-subtree-scoped actor is rejected posting outside their subtree", async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: "root" }, { id: "grandchild" }]) } as unknown as PrismaTx;
    await expect(
      announcementCreateMutation.resolve(
        { title: "x", body: "y", departmentId: "unrelated" },
        context(["announcement:create:department-subtree"], "root"),
        tx,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("a tenant-scoped actor (Admin/HR Manager) can post tenant-wide (no departmentId)", async () => {
    const tx = {
      announcement: { create: jest.fn().mockResolvedValue({ id: "a1", title: "x" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await announcementCreateMutation.resolve({ title: "x", body: "y" }, context(["announcement:create:tenant"]), tx);

    expect((tx as unknown as { announcement: { create: jest.Mock } }).announcement.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", authorId: "u1", departmentId: null, title: "x", body: "y" },
    });
  });

  it("a tenant-scoped actor can also post to any specific department", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "anywhere" }]),
      announcement: { create: jest.fn().mockResolvedValue({ id: "a1", title: "x" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await expect(
      announcementCreateMutation.resolve({ title: "x", body: "y", departmentId: "anywhere" }, context(["announcement:create:tenant"]), tx),
    ).resolves.toBeDefined();
  });
});

describe("announcement.create — audience + notifications", () => {
  it("notifies the resolved audience via one batched createMany call, excluding the author", async () => {
    const tx = {
      announcement: { create: jest.fn().mockResolvedValue({ id: "a1", title: "Standup moved" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1" }, { id: "u2" }, { id: "u3" }]) }, // u1 is the author
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    } as unknown as PrismaTx;

    await announcementCreateMutation.resolve({ title: "Standup moved", body: "y" }, context(["announcement:create:tenant"]), tx);

    const mocks = tx as unknown as { notification: { createMany: jest.Mock } };
    expect(mocks.notification.createMany).toHaveBeenCalledTimes(1); // one batched call, not a loop
    const call = mocks.notification.createMany.mock.calls[0][0];
    expect(call.data).toHaveLength(2);
    expect(call.data.map((d: { userId: string }) => d.userId).sort()).toEqual(["u2", "u3"]);
    expect(call.data[0]).toMatchObject({ tenantId: "t1", type: "announcement.posted", data: { announcementId: "a1" } });
  });

  it("skips the notification call entirely when the audience is empty besides the author", async () => {
    const tx = {
      announcement: { create: jest.fn().mockResolvedValue({ id: "a1", title: "x" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1" }]) }, // only the author
      notification: { createMany: jest.fn() },
    } as unknown as PrismaTx;

    await announcementCreateMutation.resolve({ title: "x", body: "y" }, context(["announcement:create:tenant"]), tx);

    expect((tx as unknown as { notification: { createMany: jest.Mock } }).notification.createMany).not.toHaveBeenCalled();
  });
});

describe("announcement.delete (ownership-only, no permission gate)", () => {
  it("throws NotFoundException if the announcement doesn't exist", async () => {
    const tx = { announcement: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(announcementDeleteMutation.resolve({ id: "a1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException if the actor isn't the author", async () => {
    const tx = { announcement: { findFirst: jest.fn().mockResolvedValue({ id: "a1", authorId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(announcementDeleteMutation.resolve({ id: "a1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("soft-deletes when the actor is the author", async () => {
    const tx = {
      announcement: {
        findFirst: jest.fn().mockResolvedValue({ id: "a1", authorId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "a1", deletedAt: new Date() }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await announcementDeleteMutation.resolve({ id: "a1" }, context(), tx);

    expect((tx as unknown as { announcement: { update: jest.Mock } }).announcement.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
