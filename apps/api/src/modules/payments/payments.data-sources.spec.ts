import { collapsePermissions } from "../../rbac/permission-collapse";
import { paymentsWhere, paymentsListDataSource } from "./payments.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("paymentsWhere", () => {
  it("returns null for an actor with no payment:read grant at all (e.g. Sales Rep, Billing Clerk)", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await paymentsWhere(tx, context(["invoice:create:tenant"]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await paymentsWhere(tx, context(["payment:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1" });
  });

  it("resolves :own to recordedById — defensive, no role grants this today", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await paymentsWhere(tx, context(["payment:read:own"]));
    expect(where).toEqual({ tenantId: "t1", recordedById: "u1" });
  });
});

describe("payments.list", () => {
  it("returns [] when the actor has no payment:read grant", async () => {
    const tx = { payment: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await paymentsListDataSource.resolve({ invoiceId: "i1" }, context([]), tx)).toEqual([]);
  });

  it("joins recordedByName and filters by invoiceId", async () => {
    const tx = {
      payment: { findMany: jest.fn().mockResolvedValue([{ id: "p1", recordedById: "u1", amount: 500 }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Accountant One" }]) },
    } as unknown as PrismaTx;

    const rows = (await paymentsListDataSource.resolve({ invoiceId: "i1" }, context(["payment:read:tenant"]), tx)) as {
      recordedByName: string;
    }[];
    expect(rows).toEqual([{ id: "p1", recordedById: "u1", amount: 500, recordedByName: "Accountant One" }]);
    const call = (tx as unknown as { payment: { findMany: jest.Mock } }).payment.findMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ tenantId: "t1", invoiceId: "i1" });
  });
});
