import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { clientCreateMutation, clientUpdateStatusMutation, clientAssignAccountManagerMutation } from "./clients.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("client.create", () => {
  it("creates the Client row and its backing Files Project in one transaction, defaulting accountManagerId to the creator", async () => {
    const tx = {
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      client: { create: jest.fn().mockResolvedValue({ id: "c1" }) },
      projectMember: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await clientCreateMutation.resolve({ name: "Acme Co" }, context(["client:create:tenant"]), tx);

    const projectCall = (tx as unknown as { project: { create: jest.Mock } }).project.create.mock.calls[0][0];
    expect(projectCall.data).toMatchObject({ name: "Files: Acme Co", ownerId: "u1" });

    const clientCall = (tx as unknown as { client: { create: jest.Mock } }).client.create.mock.calls[0][0];
    expect(clientCall.data).toMatchObject({ tenantId: "t1", name: "Acme Co", filesProjectId: "proj1", accountManagerId: "u1", createdById: "u1" });

    const memberCall = (tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create.mock.calls[0][0];
    expect(memberCall.data).toMatchObject({ projectId: "proj1", userId: "u1" });
  });

  it("uses an explicit accountManagerId instead of the creator when given", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "rep2" }) },
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      client: { create: jest.fn().mockResolvedValue({ id: "c1" }) },
      projectMember: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await clientCreateMutation.resolve({ name: "Acme Co", accountManagerId: "rep2" }, context(["client:create:tenant"]), tx);

    const clientCall = (tx as unknown as { client: { create: jest.Mock } }).client.create.mock.calls[0][0];
    expect(clientCall.data.accountManagerId).toBe("rep2");
  });

  it("throws NotFoundException when the given accountManagerId doesn't exist", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      clientCreateMutation.resolve({ name: "Acme Co", accountManagerId: "ghost" }, context(["client:create:tenant"]), tx),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("client.updateStatus", () => {
  it("throws NotFoundException for a client that doesn't exist", async () => {
    const tx = { client: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(clientUpdateStatusMutation.resolve({ id: "ghost", status: "inactive" }, context(["client:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("succeeds at tenant scope regardless of who owns the client", async () => {
    const tx = {
      client: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: "someone-else" }),
        update: jest.fn().mockResolvedValue({ id: "c1", status: "inactive" }),
      },
    } as unknown as PrismaTx;

    await clientUpdateStatusMutation.resolve({ id: "c1", status: "inactive" }, context(["client:update:tenant"]), tx);
    expect((tx as unknown as { client: { update: jest.Mock } }).client.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "inactive" },
    });
  });

  it("throws ForbiddenException at :own scope for a client the actor doesn't manage — the real, non-inert boundary", async () => {
    const tx = {
      client: { findFirst: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: "someone-else" }) },
    } as unknown as PrismaTx;
    await expect(clientUpdateStatusMutation.resolve({ id: "c1", status: "inactive" }, context(["client:update:own"], "u1"), tx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("succeeds at :own scope for a client the actor does manage", async () => {
    const tx = {
      client: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "c1", status: "inactive" }),
      },
    } as unknown as PrismaTx;
    await clientUpdateStatusMutation.resolve({ id: "c1", status: "inactive" }, context(["client:update:own"], "u1"), tx);
    expect((tx as unknown as { client: { update: jest.Mock } }).client.update).toHaveBeenCalled();
  });
});

describe("client.assignAccountManager", () => {
  it("reassigns and adds the new manager as a Files Project member, idempotently", async () => {
    const tx = {
      client: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: "u1", filesProjectId: "proj1" }),
        update: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: "rep2" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "rep2" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await clientAssignAccountManagerMutation.resolve({ id: "c1", accountManagerId: "rep2" }, context(["client:update:tenant"]), tx);

    expect((tx as unknown as { client: { update: jest.Mock } }).client.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { accountManagerId: "rep2" },
    });
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create).toHaveBeenCalled();
  });

  it("skips adding a duplicate Files Project member if already one", async () => {
    const tx = {
      client: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: "u1", filesProjectId: "proj1" }),
        update: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "rep2" }) },
      projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "pm1" }), create: jest.fn() },
    } as unknown as PrismaTx;

    await clientAssignAccountManagerMutation.resolve({ id: "c1", accountManagerId: "rep2" }, context(["client:update:tenant"]), tx);
    expect((tx as unknown as { projectMember: { create: jest.Mock } }).projectMember.create).not.toHaveBeenCalled();
  });
});
