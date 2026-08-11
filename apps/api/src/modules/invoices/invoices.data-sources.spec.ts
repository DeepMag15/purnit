import { collapsePermissions } from "../../rbac/permission-collapse";
import { invoicesWhere, computePaymentStatus, invoicesListDataSource, invoiceDetailDataSource } from "./invoices.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("invoicesWhere", () => {
  it("returns null for an actor with no invoice:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await invoicesWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await invoicesWhere(tx, context(["invoice:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("resolves :own transitively through Client via salesRepOwnedClientIds, not clientsWhere", async () => {
    const tx = { client: { findMany: jest.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }]) } } as unknown as PrismaTx;
    const where = await invoicesWhere(tx, context(["invoice:read:own"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, clientId: { in: ["c1", "c2"] } });
    expect((tx as unknown as { client: { findMany: jest.Mock } }).client.findMany.mock.calls[0][0].where).toMatchObject({
      accountManagerId: "u1",
    });
  });
});

describe("computePaymentStatus", () => {
  it("is 'paid' when amountPaid reaches or exceeds total", () => {
    expect(computePaymentStatus(1000, 1000, new Date("2099-01-01"), "sent")).toBe("paid");
    expect(computePaymentStatus(1000, 1200, new Date("2099-01-01"), "sent")).toBe("paid");
  });

  it("is 'partial' when some but not all has been paid", () => {
    expect(computePaymentStatus(1000, 500, new Date("2099-01-01"), "sent")).toBe("partial");
  });

  it("is 'overdue' when nothing paid, due date passed, and status is sent", () => {
    expect(computePaymentStatus(1000, 0, new Date("2020-01-01"), "sent")).toBe("overdue");
  });

  it("is 'unpaid' when nothing paid and not yet (or never) overdue", () => {
    expect(computePaymentStatus(1000, 0, new Date("2099-01-01"), "sent")).toBe("unpaid");
    expect(computePaymentStatus(1000, 0, new Date("2020-01-01"), "draft")).toBe("unpaid"); // overdue only applies to "sent"
  });
});

describe("invoices.list", () => {
  it("returns [] when the actor has no invoice:read grant", async () => {
    const tx = { invoice: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await invoicesListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });

  it("joins clientName and amountPaid, and derives paymentStatus", async () => {
    const tx = {
      invoice: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "i1", clientId: "c1", status: "sent", dueDate: new Date("2099-01-01"), total: 1000 }]),
      },
      client: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Acme Co" }]) },
      payment: { groupBy: jest.fn().mockResolvedValue([{ invoiceId: "i1", _sum: { amount: 400 } }]) },
    } as unknown as PrismaTx;

    const rows = (await invoicesListDataSource.resolve({}, context(["invoice:read:tenant"]), tx)) as {
      clientName: string;
      amountPaid: number;
      paymentStatus: string;
    }[];
    expect(rows).toEqual([
      expect.objectContaining({ clientName: "Acme Co", amountPaid: 400, paymentStatus: "partial" }),
    ]);
  });
});

describe("invoices.detail", () => {
  it("throws NotFoundException for an invoice that doesn't exist or is out of scope", async () => {
    const tx = { invoice: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(invoiceDetailDataSource.resolve({ id: "ghost" }, context(["invoice:read:tenant"]), tx)).rejects.toThrow("No invoice");
  });

  it("computes amountPaid/paymentStatus from a direct payment aggregate, and capability flags", async () => {
    const tx = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ id: "i1", clientId: "c1", status: "sent", dueDate: new Date("2099-01-01"), total: 1000 }),
      },
      client: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Acme Co" }]) },
      payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 1000 } }) },
    } as unknown as PrismaTx;

    const data = (await invoiceDetailDataSource.resolve(
      { id: "i1" },
      context(["invoice:read:tenant", "payment:create:tenant"]),
      tx,
    )) as { amountPaid: number; paymentStatus: string; canRecordPayments: boolean; canReadPayments: boolean };
    expect(data.amountPaid).toBe(1000);
    expect(data.paymentStatus).toBe("paid");
    expect(data.canRecordPayments).toBe(true);
    expect(data.canReadPayments).toBe(false);
  });
});
