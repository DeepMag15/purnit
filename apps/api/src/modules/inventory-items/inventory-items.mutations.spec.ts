import { BadRequestException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { inventoryItemCreateMutation, inventoryItemUpdateMutation, inventoryItemAdjustStockMutation } from "./inventory-items.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("inventoryItem.create", () => {
  it("creates the item and its backing files Project, currentStock starts at 0", async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "i1" }),
      },
      project: { create: jest.fn().mockResolvedValue({ id: "proj1" }) },
      projectMember: { create: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await inventoryItemCreateMutation.resolve(
      { sku: "WIDGET-1", name: "Widget", type: "finished_good", unitOfMeasure: "each" },
      context(["inventoryItem:create:tenant"]),
      tx,
    );

    const call = (tx as unknown as { inventoryItem: { create: jest.Mock } }).inventoryItem.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ tenantId: "t1", filesProjectId: "proj1", sku: "WIDGET-1", name: "Widget", createdById: "u1" });
    expect(call.data.currentStock).toBeUndefined(); // relies on the schema default of 0, never set explicitly
  });

  it("rejects a duplicate SKU within the same tenant", async () => {
    const tx = {
      inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: "existing" }) },
    } as unknown as PrismaTx;

    await expect(
      inventoryItemCreateMutation.resolve(
        { sku: "WIDGET-1", name: "Widget", type: "finished_good", unitOfMeasure: "each" },
        context(["inventoryItem:create:tenant"]),
        tx,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("inventoryItem.update", () => {
  it("throws NotFoundException for an item that doesn't exist", async () => {
    const tx = { inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(inventoryItemUpdateMutation.resolve({ id: "ghost", name: "New" }, context(["inventoryItem:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("only patches the fields provided", async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue({ id: "i1" }),
        update: jest.fn().mockResolvedValue({ id: "i1" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await inventoryItemUpdateMutation.resolve({ id: "i1", reorderPoint: 10 }, context(["inventoryItem:update:tenant"]), tx);
    expect((tx as unknown as { inventoryItem: { update: jest.Mock } }).inventoryItem.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { reorderPoint: 10 },
    });
  });
});

describe("inventoryItem.adjustStock", () => {
  it("throws NotFoundException for an item that doesn't exist", async () => {
    const tx = { inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(inventoryItemAdjustStockMutation.resolve({ id: "ghost", delta: 5, reason: "count" }, context(["inventoryItem:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("applies a positive delta", async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue({ id: "i1", currentStock: 10, name: "Widget" }),
        update: jest.fn().mockResolvedValue({ id: "i1", currentStock: 15 }),
      },
    } as unknown as PrismaTx;
    await inventoryItemAdjustStockMutation.resolve({ id: "i1", delta: 5, reason: "found extra stock" }, context(["inventoryItem:update:tenant"]), tx);
    expect((tx as unknown as { inventoryItem: { update: jest.Mock } }).inventoryItem.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { currentStock: 15 },
    });
  });

  it("rejects a negative delta that would take stock below zero", async () => {
    const tx = {
      inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: "i1", currentStock: 3, name: "Widget" }) },
    } as unknown as PrismaTx;
    await expect(
      inventoryItemAdjustStockMutation.resolve({ id: "i1", delta: -10, reason: "damaged" }, context(["inventoryItem:update:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });
});
