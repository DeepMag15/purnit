import { BadRequestException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { purchaseOrderCreateMutation, purchaseOrderUpdateStatusMutation, purchaseOrderReceiveMutation } from "./purchase-orders.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("purchaseOrder.create", () => {
  it("computes subtotal/total server-side from lineItems, never trusting a client-provided amount", async () => {
    const tx = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
      inventoryItem: { findFirst: jest.fn().mockResolvedValue({ id: "i1" }) },
      purchaseOrder: { create: jest.fn().mockResolvedValue({ id: "po1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await purchaseOrderCreateMutation.resolve(
      {
        supplierId: "s1",
        expectedDate: "2026-02-01",
        lineItems: [{ inventoryItemId: "i1", description: "Steel rod", quantity: 10, unitCost: 500 }],
        tax: 200,
      },
      context(["purchaseOrder:create:tenant"]),
      tx,
    );

    const call = (tx as unknown as { purchaseOrder: { create: jest.Mock } }).purchaseOrder.create.mock.calls[0][0];
    expect(call.data.subtotal).toBe(5000);
    expect(call.data.tax).toBe(200);
    expect(call.data.total).toBe(5200);
    expect(call.data.status).toBe("draft");
  });

  it("throws NotFoundException when the supplier doesn't exist", async () => {
    const tx = { supplier: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      purchaseOrderCreateMutation.resolve(
        { supplierId: "ghost", expectedDate: "2026-02-01", lineItems: [{ inventoryItemId: "i1", description: "X", quantity: 1, unitCost: 100 }] },
        context(["purchaseOrder:create:tenant"]),
        tx,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("purchaseOrder.updateStatus", () => {
  it("allows draft -> submitted", async () => {
    const tx = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({ id: "po1", status: "draft" }),
        update: jest.fn().mockResolvedValue({ id: "po1", status: "submitted" }),
      },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;
    await purchaseOrderUpdateStatusMutation.resolve({ id: "po1", status: "submitted" }, context(["purchaseOrder:update:tenant"]), tx);
    expect((tx as unknown as { purchaseOrder: { update: jest.Mock } }).purchaseOrder.update).toHaveBeenCalled();
  });

  it("rejects submitted -> draft (never a backward transition)", async () => {
    const tx = { purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: "po1", status: "submitted" }) } } as unknown as PrismaTx;
    await expect(purchaseOrderUpdateStatusMutation.resolve({ id: "po1", status: "draft" }, context(["purchaseOrder:update:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects any transition out of received (that's purchaseOrder.receive's own job)", async () => {
    const tx = { purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: "po1", status: "received" }) } } as unknown as PrismaTx;
    await expect(
      purchaseOrderUpdateStatusMutation.resolve({ id: "po1", status: "cancelled" }, context(["purchaseOrder:update:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("purchaseOrder.receive", () => {
  // The procurement half of this domain's segregation-of-duties proof at the
  // unit level: purchaseOrder:receive is a distinct permission from
  // purchaseOrder:update, never both held by Procurement Officer in
  // MANUFACTURING_BLUEPRINT_V1 — the generic requiredPermission gate is what
  // actually 403s a Procurement Officer attempting this; this just confirms
  // the right permission is declared.
  it("requires purchaseOrder:receive", () => {
    expect(purchaseOrderReceiveMutation.requiredPermission).toBe("purchaseOrder:receive");
  });

  it("throws BadRequestException against a draft order — cannot receive one that hasn't been submitted", async () => {
    const tx = { purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: "po1", status: "draft" }) } } as unknown as PrismaTx;
    await expect(purchaseOrderReceiveMutation.resolve({ id: "po1" }, context(["purchaseOrder:receive:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException against an already-received order", async () => {
    const tx = { purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: "po1", status: "received" }) } } as unknown as PrismaTx;
    await expect(purchaseOrderReceiveMutation.resolve({ id: "po1" }, context(["purchaseOrder:receive:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("increments each line item's InventoryItem.currentStock and marks the order received", async () => {
    const tx = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: "po1",
          status: "submitted",
          lineItems: [
            { inventoryItemId: "i1", quantity: 10 },
            { inventoryItemId: "i2", quantity: 5 },
          ],
        }),
        update: jest.fn().mockResolvedValue({ id: "po1", status: "received" }),
      },
      inventoryItem: { update: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await purchaseOrderReceiveMutation.resolve({ id: "po1" }, context(["purchaseOrder:receive:tenant"]), tx);

    const itemUpdateMock = (tx as unknown as { inventoryItem: { update: jest.Mock } }).inventoryItem.update;
    expect(itemUpdateMock).toHaveBeenCalledWith({ where: { id: "i1" }, data: { currentStock: { increment: 10 } } });
    expect(itemUpdateMock).toHaveBeenCalledWith({ where: { id: "i2" }, data: { currentStock: { increment: 5 } } });
    expect((tx as unknown as { purchaseOrder: { update: jest.Mock } }).purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: "po1" },
      data: { status: "received" },
    });
  });
});
