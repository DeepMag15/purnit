import { BadRequestException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { bomLineCreateMutation, bomLineUpdateMutation, bomLineDeleteMutation } from "./bom-lines.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("bomLine.create", () => {
  it("rejects an item being its own component", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(
      bomLineCreateMutation.resolve({ parentItemId: "i1", componentItemId: "i1", quantityRequired: 2 }, context(["bomLine:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the parent item doesn't exist", async () => {
    const tx = { inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      bomLineCreateMutation.resolve({ parentItemId: "ghost", componentItemId: "i2", quantityRequired: 2 }, context(["bomLine:create:tenant"]), tx),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects a duplicate component already on the recipe", async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: "i1" }).mockResolvedValueOnce({ id: "i2" }),
      },
      bOMLine: { findFirst: jest.fn().mockResolvedValue({ id: "existing" }) },
    } as unknown as PrismaTx;

    await expect(
      bomLineCreateMutation.resolve({ parentItemId: "i1", componentItemId: "i2", quantityRequired: 2 }, context(["bomLine:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("creates the BOM line", async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: "i1" }).mockResolvedValueOnce({ id: "i2" }),
      },
      bOMLine: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "bl1" }) },
    } as unknown as PrismaTx;

    await bomLineCreateMutation.resolve({ parentItemId: "i1", componentItemId: "i2", quantityRequired: 3 }, context(["bomLine:create:tenant"]), tx);
    const call = (tx as unknown as { bOMLine: { create: jest.Mock } }).bOMLine.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ tenantId: "t1", parentItemId: "i1", componentItemId: "i2", quantityRequired: 3, createdById: "u1" });
  });
});

describe("bomLine.update", () => {
  it("throws NotFoundException for a BOM line that doesn't exist", async () => {
    const tx = { bOMLine: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(bomLineUpdateMutation.resolve({ id: "ghost", quantityRequired: 5 }, context(["bomLine:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("updates the required quantity", async () => {
    const tx = {
      bOMLine: {
        findFirst: jest.fn().mockResolvedValue({ id: "bl1" }),
        update: jest.fn().mockResolvedValue({ id: "bl1", quantityRequired: 5 }),
      },
    } as unknown as PrismaTx;
    await bomLineUpdateMutation.resolve({ id: "bl1", quantityRequired: 5 }, context(["bomLine:update:tenant"]), tx);
    expect((tx as unknown as { bOMLine: { update: jest.Mock } }).bOMLine.update).toHaveBeenCalledWith({
      where: { id: "bl1" },
      data: { quantityRequired: 5 },
    });
  });
});

describe("bomLine.delete", () => {
  it("throws NotFoundException for a BOM line that doesn't exist", async () => {
    const tx = { bOMLine: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(bomLineDeleteMutation.resolve({ id: "ghost" }, context(["bomLine:delete:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });

  it("deletes the BOM line", async () => {
    const tx = {
      bOMLine: { findFirst: jest.fn().mockResolvedValue({ id: "bl1" }), delete: jest.fn().mockResolvedValue({ id: "bl1" }) },
    } as unknown as PrismaTx;
    await bomLineDeleteMutation.resolve({ id: "bl1" }, context(["bomLine:delete:tenant"]), tx);
    expect((tx as unknown as { bOMLine: { delete: jest.Mock } }).bOMLine.delete).toHaveBeenCalledWith({ where: { id: "bl1" } });
  });
});
