import { BadRequestException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { invoiceCreateMutation, invoiceUpdateStatusMutation } from "./invoices.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("invoice.create", () => {
  it("computes subtotal/total server-side from lineItems, never trusting a client-provided amount", async () => {
    const tx = {
      client: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      invoice: { create: jest.fn().mockResolvedValue({ id: "i1" }) },
    } as unknown as PrismaTx;

    await invoiceCreateMutation.resolve(
      {
        clientId: "c1",
        issueDate: "2026-01-01",
        dueDate: "2026-02-01",
        lineItems: [
          { description: "Consulting", quantity: 2, unitPrice: 10000 },
          { description: "Setup fee", quantity: 1, unitPrice: 5000 },
        ],
        tax: 2000,
      },
      context(["invoice:create:tenant"]),
      tx,
    );

    const call = (tx as unknown as { invoice: { create: jest.Mock } }).invoice.create.mock.calls[0][0];
    expect(call.data.subtotal).toBe(25000); // (2*10000) + (1*5000)
    expect(call.data.tax).toBe(2000);
    expect(call.data.total).toBe(27000);
    expect(call.data.status).toBe("draft");
    expect(call.data.lineItems).toEqual([
      { description: "Consulting", quantity: 2, unitPrice: 10000, amount: 20000 },
      { description: "Setup fee", quantity: 1, unitPrice: 5000, amount: 5000 },
    ]);
  });

  it("defaults tax to 0 when omitted", async () => {
    const tx = {
      client: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      invoice: { create: jest.fn().mockResolvedValue({ id: "i1" }) },
    } as unknown as PrismaTx;

    await invoiceCreateMutation.resolve(
      { clientId: "c1", issueDate: "2026-01-01", dueDate: "2026-02-01", lineItems: [{ description: "X", quantity: 1, unitPrice: 1000 }] },
      context(["invoice:create:tenant"]),
      tx,
    );

    const call = (tx as unknown as { invoice: { create: jest.Mock } }).invoice.create.mock.calls[0][0];
    expect(call.data.tax).toBe(0);
    expect(call.data.total).toBe(1000);
  });

  it("throws NotFoundException when the client doesn't exist", async () => {
    const tx = { client: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      invoiceCreateMutation.resolve(
        { clientId: "ghost", issueDate: "2026-01-01", dueDate: "2026-02-01", lineItems: [{ description: "X", quantity: 1, unitPrice: 1000 }] },
        context(["invoice:create:tenant"]),
        tx,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("invoice.updateStatus", () => {
  it("throws NotFoundException for an invoice that doesn't exist", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(invoiceUpdateStatusMutation.resolve({ id: "ghost", status: "sent" }, context(["invoice:update:tenant"]), tx)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("allows draft -> sent", async () => {
    const tx = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "draft" }),
        update: jest.fn().mockResolvedValue({ id: "i1", status: "sent" }),
      },
    } as unknown as PrismaTx;
    await invoiceUpdateStatusMutation.resolve({ id: "i1", status: "sent" }, context(["invoice:update:tenant"]), tx);
    expect((tx as unknown as { invoice: { update: jest.Mock } }).invoice.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "sent" },
    });
  });

  it("allows sent -> void", async () => {
    const tx = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "sent" }),
        update: jest.fn().mockResolvedValue({ id: "i1", status: "void" }),
      },
    } as unknown as PrismaTx;
    await invoiceUpdateStatusMutation.resolve({ id: "i1", status: "void" }, context(["invoice:update:tenant"]), tx);
    expect((tx as unknown as { invoice: { update: jest.Mock } }).invoice.update).toHaveBeenCalled();
  });

  it("rejects sent -> draft (never a backward transition)", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "sent" }) } } as unknown as PrismaTx;
    await expect(invoiceUpdateStatusMutation.resolve({ id: "i1", status: "draft" }, context(["invoice:update:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects any transition out of void", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "void" }) } } as unknown as PrismaTx;
    await expect(invoiceUpdateStatusMutation.resolve({ id: "i1", status: "sent" }, context(["invoice:update:tenant"]), tx)).rejects.toThrow(
      BadRequestException,
    );
  });
});
