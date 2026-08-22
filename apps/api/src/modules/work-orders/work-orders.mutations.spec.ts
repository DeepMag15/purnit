import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { workOrderCreateMutation, workOrderUpdateStatusMutation, workOrderCompleteMutation } from "./work-orders.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("workOrder.create", () => {
  it("defaults assignedToId to the creator — a real, non-inert :own scope floor", async () => {
    const tx = {
      inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: "i1" }) },
      workOrder: { create: jest.fn().mockResolvedValue({ id: "wo1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await workOrderCreateMutation.resolve({ itemId: "i1", quantity: 5, dueDate: "2026-03-01" }, context(["workOrder:create:tenant"]), tx);
    const call = (tx as unknown as { workOrder: { create: jest.Mock } }).workOrder.create.mock.calls[0][0];
    expect(call.data.assignedToId).toBe("u1");
  });

  it("throws NotFoundException when the item doesn't exist", async () => {
    const tx = { inventoryItem: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      workOrderCreateMutation.resolve({ itemId: "ghost", quantity: 5, dueDate: "2026-03-01" }, context(["workOrder:create:tenant"]), tx),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("workOrder.updateStatus", () => {
  it("allows planned -> in_progress for the assigned Production Planner (own scope)", async () => {
    const tx = {
      workOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: "wo1", status: "planned", assignedToId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "wo1", status: "in_progress" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await workOrderUpdateStatusMutation.resolve({ id: "wo1", status: "in_progress" }, context(["workOrder:update:own"], "u1"), tx);
    expect((tx as unknown as { workOrder: { update: jest.Mock } }).workOrder.update).toHaveBeenCalled();
  });

  it("throws ForbiddenException for a Production Planner not assigned to this work order — the real :own boundary", async () => {
    const tx = {
      workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", status: "planned", assignedToId: "someone-else" }) },
    } as unknown as PrismaTx;
    await expect(
      workOrderUpdateStatusMutation.resolve({ id: "wo1", status: "in_progress" }, context(["workOrder:update:own"], "u1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects any transition to completed (that's workOrder.complete's own job) — 'completed' isn't even in the input schema's enum", () => {
    expect(() => workOrderUpdateStatusMutation.inputSchema.parse({ id: "wo1", status: "completed" })).toThrow();
  });

  it("rejects in_progress -> planned (never a backward transition)", async () => {
    const tx = {
      workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", status: "in_progress", assignedToId: "u1" }) },
    } as unknown as PrismaTx;
    await expect(
      workOrderUpdateStatusMutation.resolve({ id: "wo1", status: "planned" }, context(["workOrder:update:own"], "u1"), tx),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("workOrder.complete", () => {
  // The production half of this domain's segregation-of-duties proof at the
  // unit level: workOrder:complete is a distinct permission from
  // workOrder:update, never held by Production Planner in
  // MANUFACTURING_BLUEPRINT_V1 — the generic requiredPermission gate is what
  // actually 403s a Planner attempting this; this just confirms the right
  // permission is declared, with no :own check involved at all (matches
  // payment.record's own flat-grant shape).
  it("requires workOrder:complete", () => {
    expect(workOrderCompleteMutation.requiredPermission).toBe("workOrder:complete");
  });

  it("throws BadRequestException against a planned order — cannot complete one that hasn't started", async () => {
    const tx = { workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", status: "planned" }) } } as unknown as PrismaTx;
    await expect(workOrderCompleteMutation.resolve({ id: "wo1" }, context(["workOrder:complete:tenant"]), tx)).rejects.toThrow(BadRequestException);
  });

  it("rejects completion when a component's stock is insufficient, mutating nothing", async () => {
    const tx = {
      workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", itemId: "finished1", quantity: 2, status: "in_progress" }) },
      bOMLine: { findMany: jest.fn().mockResolvedValue([{ componentItemId: "raw1", quantityRequired: 3 }]) },
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([{ id: "raw1", name: "Steel Rod", currentStock: 5 }]), // needs 3*2=6, only has 5
        update: jest.fn(),
      },
    } as unknown as PrismaTx;

    await expect(workOrderCompleteMutation.resolve({ id: "wo1" }, context(["workOrder:complete:tenant"]), tx)).rejects.toThrow(BadRequestException);
    expect((tx as unknown as { inventoryItem: { update: jest.Mock } }).inventoryItem.update).not.toHaveBeenCalled();
  });

  it("decrements each component by quantityRequired × workOrder.quantity and increments the finished good, on sufficient stock", async () => {
    const tx = {
      workOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: "wo1", itemId: "finished1", quantity: 2, status: "in_progress" }),
        update: jest.fn().mockResolvedValue({ id: "wo1", status: "completed" }),
      },
      bOMLine: {
        findMany: jest.fn().mockResolvedValue([
          { componentItemId: "raw1", quantityRequired: 3 },
          { componentItemId: "raw2", quantityRequired: 1 },
        ]),
      },
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: "raw1", name: "Steel Rod", currentStock: 10 },
          { id: "raw2", name: "Bolt", currentStock: 4 },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await workOrderCompleteMutation.resolve({ id: "wo1" }, context(["workOrder:complete:tenant"]), tx);

    const itemUpdateMock = (tx as unknown as { inventoryItem: { update: jest.Mock } }).inventoryItem.update;
    expect(itemUpdateMock).toHaveBeenCalledWith({ where: { id: "raw1" }, data: { currentStock: { decrement: 6 } } }); // 3*2
    expect(itemUpdateMock).toHaveBeenCalledWith({ where: { id: "raw2" }, data: { currentStock: { decrement: 2 } } }); // 1*2
    expect(itemUpdateMock).toHaveBeenCalledWith({ where: { id: "finished1" }, data: { currentStock: { increment: 2 } } });
    expect((tx as unknown as { workOrder: { update: jest.Mock } }).workOrder.update).toHaveBeenCalledWith({
      where: { id: "wo1" },
      data: { status: "completed" },
    });
  });

  it("skips BOM math entirely for an item with no recipe, still marks completed and increments finished stock", async () => {
    const tx = {
      workOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: "wo1", itemId: "finished1", quantity: 3, status: "in_progress" }),
        update: jest.fn().mockResolvedValue({ id: "wo1", status: "completed" }),
      },
      bOMLine: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryItem: { update: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await workOrderCompleteMutation.resolve({ id: "wo1" }, context(["workOrder:complete:tenant"]), tx);
    const itemUpdateMock = (tx as unknown as { inventoryItem: { update: jest.Mock } }).inventoryItem.update;
    expect(itemUpdateMock).toHaveBeenCalledTimes(1);
    expect(itemUpdateMock).toHaveBeenCalledWith({ where: { id: "finished1" }, data: { currentStock: { increment: 3 } } });
  });
});
