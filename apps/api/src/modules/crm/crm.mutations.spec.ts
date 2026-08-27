import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { contactCreateMutation, contactUpdateMutation, dealCreateMutation, dealUpdateMutation, dealUpdateStageMutation } from "./crm.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("contact.create", () => {
  it("defaults ownerId to the creator", async () => {
    const tx = {
      contact: { create: jest.fn().mockResolvedValue({ id: "c1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await contactCreateMutation.resolve({ name: "Acme Corp" }, context(["contact:create:own"]), tx);
    const call = (tx as unknown as { contact: { create: jest.Mock } }).contact.create.mock.calls[0][0];
    expect(call.data.ownerId).toBe("u1");
    expect(call.data.createdById).toBe("u1");
  });

  it("respects an explicit ownerId when the target user exists", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      contact: { create: jest.fn().mockResolvedValue({ id: "c1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await contactCreateMutation.resolve({ name: "Acme Corp", ownerId: "u2" }, context(["contact:create:tenant"]), tx);
    const call = (tx as unknown as { contact: { create: jest.Mock } }).contact.create.mock.calls[0][0];
    expect(call.data.ownerId).toBe("u2");
  });

  it("throws NotFoundException for a nonexistent ownerId", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(contactCreateMutation.resolve({ name: "Acme Corp", ownerId: "ghost" }, context(["contact:create:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });
});

describe("contact.update — authorization", () => {
  it("the owner can update their own contact even with only :own granted", async () => {
    const tx = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", ownerId: "u1" }), update: jest.fn().mockResolvedValue({ id: "c1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await contactUpdateMutation.resolve({ id: "c1", name: "New Name" }, context(["contact:update:own"]), tx);
    expect((tx as unknown as { contact: { update: jest.Mock } }).contact.update).toHaveBeenCalled();
  });

  it("rejects a non-owner holding only :own", async () => {
    const tx = { contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", ownerId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(contactUpdateMutation.resolve({ id: "c1", name: "New Name" }, context(["contact:update:own"]), tx)).rejects.toThrow(ForbiddenException);
  });

  it(":tenant scope can update any contact regardless of owner", async () => {
    const tx = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", ownerId: "someone-else" }), update: jest.fn().mockResolvedValue({ id: "c1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await contactUpdateMutation.resolve({ id: "c1", name: "New Name" }, context(["contact:update:tenant"]), tx);
    expect((tx as unknown as { contact: { update: jest.Mock } }).contact.update).toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown contact", async () => {
    const tx = { contact: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(contactUpdateMutation.resolve({ id: "ghost" }, context(["contact:update:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });
});

describe("deal.create", () => {
  it("throws NotFoundException when the target contact isn't visible to the actor (real read-scope check, not just tenant existence)", async () => {
    const tx = { contact: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(dealCreateMutation.resolve({ contactId: "c1", title: "New Deal" }, context(["deal:create:own", "contact:read:own"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("creates the deal, defaulting ownerId to the creator and valueCents to 0", async () => {
    const tx = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", ownerId: "u1" }) },
      deal: { create: jest.fn().mockResolvedValue({ id: "d1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await dealCreateMutation.resolve({ contactId: "c1", title: "New Deal" }, context(["deal:create:own", "contact:read:own"]), tx);
    const call = (tx as unknown as { deal: { create: jest.Mock } }).deal.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ contactId: "c1", title: "New Deal", valueCents: 0, ownerId: "u1" });
  });
});

describe("deal.update / deal.updateStage — authorization", () => {
  it("the owner can update their own deal even with only :own granted", async () => {
    const tx = {
      deal: { findFirst: jest.fn().mockResolvedValue({ id: "d1", ownerId: "u1" }), update: jest.fn().mockResolvedValue({ id: "d1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await dealUpdateMutation.resolve({ id: "d1", title: "Renamed" }, context(["deal:update:own"]), tx);
    expect((tx as unknown as { deal: { update: jest.Mock } }).deal.update).toHaveBeenCalled();
  });

  it("rejects a non-owner holding only :own", async () => {
    const tx = { deal: { findFirst: jest.fn().mockResolvedValue({ id: "d1", ownerId: "someone-else" }) } } as unknown as PrismaTx;
    await expect(dealUpdateMutation.resolve({ id: "d1", title: "Renamed" }, context(["deal:update:own"]), tx)).rejects.toThrow(ForbiddenException);
  });

  it("deal.updateStage succeeds for the owner and writes only the stage field", async () => {
    const tx = {
      deal: { findFirst: jest.fn().mockResolvedValue({ id: "d1", ownerId: "u1" }), update: jest.fn().mockResolvedValue({ id: "d1", stage: "won" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await dealUpdateStageMutation.resolve({ id: "d1", stage: "won" }, context(["deal:update:own"]), tx);
    expect((tx as unknown as { deal: { update: jest.Mock } }).deal.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { stage: "won" } });
  });

  it("throws NotFoundException for an unknown deal", async () => {
    const tx = { deal: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(dealUpdateStageMutation.resolve({ id: "ghost", stage: "won" }, context(["deal:update:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });
});
