import { collapsePermissions } from "../../rbac/permission-collapse";
import { invoicesOverdueCountMetric, invoicesTotalOutstandingMetric } from "./invoices.metrics";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[]): DataSourceContext {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("invoicesOverdueCountMetric", () => {
  it("requires invoice:read", () => {
    expect(invoicesOverdueCountMetric.requiredPermission).toBe("invoice:read");
  });

  it("returns 0 and never queries with no invoice:read grant", async () => {
    const tx = { invoice: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await invoicesOverdueCountMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { invoice: { findMany: jest.Mock } }).invoice.findMany).not.toHaveBeenCalled();
  });

  it("excludes a fully-paid invoice despite status still being 'sent' and the due date having passed", async () => {
    // The one genuinely tricky case: "paid" is never a stored status (see
    // invoice.prisma's own doc comment) — a naive status+dueDate count
    // would wrongly include this row.
    const tx = {
      invoice: { findMany: jest.fn().mockResolvedValue([{ id: "i1", total: 1000 }]) },
      payment: { groupBy: jest.fn().mockResolvedValue([{ invoiceId: "i1", _sum: { amount: 1000 } }]) },
    } as unknown as PrismaTx;
    const value = await invoicesOverdueCountMetric.computeLive(context(["invoice:read:tenant"]), tx);
    expect(value).toBe(0);
  });

  it("counts an overdue invoice with no payment at all", async () => {
    const tx = {
      invoice: { findMany: jest.fn().mockResolvedValue([{ id: "i1", total: 1000 }]) },
      payment: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;
    const value = await invoicesOverdueCountMetric.computeLive(context(["invoice:read:tenant"]), tx);
    expect(value).toBe(1);
  });

  it("counts an overdue invoice that's only partially paid", async () => {
    const tx = {
      invoice: { findMany: jest.fn().mockResolvedValue([{ id: "i1", total: 1000 }]) },
      payment: { groupBy: jest.fn().mockResolvedValue([{ invoiceId: "i1", _sum: { amount: 400 } }]) },
    } as unknown as PrismaTx;
    const value = await invoicesOverdueCountMetric.computeLive(context(["invoice:read:tenant"]), tx);
    expect(value).toBe(1);
  });

  it("filters invoice.findMany by status:sent and dueDate < now", async () => {
    const tx = {
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;
    await invoicesOverdueCountMetric.computeLive(context(["invoice:read:tenant"]), tx);
    const call = (tx as unknown as { invoice: { findMany: jest.Mock } }).invoice.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", status: "sent" });
    expect(call.where.dueDate.lt).toBeInstanceOf(Date);
  });
});

describe("invoicesTotalOutstandingMetric", () => {
  it("requires invoice:read and formats as currency", () => {
    expect(invoicesTotalOutstandingMetric.requiredPermission).toBe("invoice:read");
    expect(invoicesTotalOutstandingMetric.format).toBe("currency");
  });

  it("sums (total - amountPaid) across every sent invoice in scope", async () => {
    const tx = {
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: "i1", total: 1000 },
          { id: "i2", total: 2000 },
        ]),
      },
      payment: {
        groupBy: jest.fn().mockResolvedValue([
          { invoiceId: "i1", _sum: { amount: 400 } }, // 600 outstanding
          // i2 has no payments at all — full 2000 outstanding
        ]),
      },
    } as unknown as PrismaTx;
    const value = await invoicesTotalOutstandingMetric.computeLive(context(["invoice:read:tenant"]), tx);
    expect(value).toBe(2600);
  });

  it("floors at 0 per invoice rather than going negative if overpaid", async () => {
    const tx = {
      invoice: { findMany: jest.fn().mockResolvedValue([{ id: "i1", total: 1000 }]) },
      payment: { groupBy: jest.fn().mockResolvedValue([{ invoiceId: "i1", _sum: { amount: 1500 } }]) },
    } as unknown as PrismaTx;
    const value = await invoicesTotalOutstandingMetric.computeLive(context(["invoice:read:tenant"]), tx);
    expect(value).toBe(0);
  });

  it("returns 0 with no invoice:read grant", async () => {
    const tx = { invoice: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await invoicesTotalOutstandingMetric.computeLive(context([]), tx)).toBe(0);
    expect((tx as unknown as { invoice: { findMany: jest.Mock } }).invoice.findMany).not.toHaveBeenCalled();
  });
});
