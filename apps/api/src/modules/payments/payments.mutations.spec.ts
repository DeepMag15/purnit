import { BadRequestException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { paymentRecordMutation } from "./payments.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("payment.record", () => {
  // The separation-of-duties proof at the unit level: Billing Clerk never
  // holds payment:create in FINANCE_BLUEPRINT_V1 (only Admin/Accountant do)
  // — the generic requiredPermission gate (tested by the mutation registry
  // itself) is what actually 403s it; this just confirms the right
  // permission is declared.
  it("requires payment:create", () => {
    expect(paymentRecordMutation.requiredPermission).toBe("payment:create");
  });

  it("throws NotFoundException when the invoice doesn't exist", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(
      paymentRecordMutation.resolve({ invoiceId: "ghost", amount: 500, method: "cash" }, context(["payment:create:tenant"]), tx),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws BadRequestException against a draft invoice — cannot pay one that hasn't been sent", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "draft" }) } } as unknown as PrismaTx;
    await expect(
      paymentRecordMutation.resolve({ invoiceId: "i1", amount: 500, method: "cash" }, context(["payment:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws BadRequestException against a void invoice", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "void" }) } } as unknown as PrismaTx;
    await expect(
      paymentRecordMutation.resolve({ invoiceId: "i1", amount: 500, method: "cash" }, context(["payment:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("records a payment against a sent invoice, recordedById from ctx", async () => {
    const tx = {
      invoice: { findFirst: jest.fn().mockResolvedValue({ id: "i1", status: "sent" }) },
      payment: { create: jest.fn().mockResolvedValue({ id: "p1" }) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    await paymentRecordMutation.resolve({ invoiceId: "i1", amount: 500, method: "cash", notes: "partial" }, context(["payment:create:tenant"]), tx);

    const call = (tx as unknown as { payment: { create: jest.Mock } }).payment.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ tenantId: "t1", invoiceId: "i1", amount: 500, method: "cash", recordedById: "u1", notes: "partial" });
  });
});
