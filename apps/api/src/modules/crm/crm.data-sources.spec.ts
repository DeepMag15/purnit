import { collapsePermissions } from "../../rbac/permission-collapse";
import { contactsListDataSource, contactDetailDataSource, dealsListDataSource, crmCapabilitiesDataSource } from "./crm.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("contacts.list", () => {
  it("returns [] with no contact:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    const result = await contactsListDataSource.resolve({}, context([]), tx);
    expect(result).toEqual([]);
  });

  it(":tenant scope sees every contact, no ownerId filter applied", async () => {
    const tx = {
      contact: { findMany: jest.fn().mockResolvedValue([{ id: "c1", ownerId: "someone-else" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "someone-else", displayName: "Someone Else" }]) },
      deal: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await contactsListDataSource.resolve({}, context(["contact:read:tenant"]), tx);

    const call = (tx as unknown as { contact: { findMany: jest.Mock } }).contact.findMany.mock.calls[0][0];
    expect(call.where.ownerId).toBeUndefined();
  });

  it(":own scope filters to the actor's own contacts", async () => {
    const tx = {
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      deal: { groupBy: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await contactsListDataSource.resolve({}, context(["contact:read:own"]), tx);

    const call = (tx as unknown as { contact: { findMany: jest.Mock } }).contact.findMany.mock.calls[0][0];
    expect(call.where.ownerId).toBe("u1");
  });
});

describe("contact.detail", () => {
  it("includes linked deals and capability flags", async () => {
    const tx = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", ownerId: "u1" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      deal: { findMany: jest.fn().mockResolvedValue([{ id: "d1" }]) },
    } as unknown as PrismaTx;

    const result = (await contactDetailDataSource.resolve({ id: "c1" }, context(["contact:read:own", "deal:create:own"]), tx)) as {
      deals: unknown[];
      canCreateDeals: boolean;
    };

    expect(result.deals).toEqual([{ id: "d1" }]);
    expect(result.canCreateDeals).toBe(true);
  });
});

describe("deals.list", () => {
  it(":own scope filters to the actor's own deals", async () => {
    const tx = {
      deal: { findMany: jest.fn().mockResolvedValue([]) },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await dealsListDataSource.resolve({}, context(["deal:read:own"]), tx);

    const call = (tx as unknown as { deal: { findMany: jest.Mock } }).deal.findMany.mock.calls[0][0];
    expect(call.where.ownerId).toBe("u1");
  });

  it("filters by contactId when provided, on top of the scope where-clause", async () => {
    const tx = {
      deal: { findMany: jest.fn().mockResolvedValue([]) },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaTx;

    await dealsListDataSource.resolve({ contactId: "c1" }, context(["deal:read:tenant"]), tx);

    const call = (tx as unknown as { deal: { findMany: jest.Mock } }).deal.findMany.mock.calls[0][0];
    expect(call.where.contactId).toBe("c1");
  });
});

describe("crm.capabilities", () => {
  const tx = {} as unknown as PrismaTx;

  it("all false with no grants at all", async () => {
    const result = await crmCapabilitiesDataSource.resolve({}, context([]), tx);
    expect(result).toEqual({ canCreateContact: false, canCreateDeal: false, canUpdateDeal: false });
  });

  it("independently true per granted permission", async () => {
    const result = await crmCapabilitiesDataSource.resolve({}, context(["contact:create:own", "deal:update:tenant"]), tx);
    expect(result).toEqual({ canCreateContact: true, canCreateDeal: false, canUpdateDeal: true });
  });
});
