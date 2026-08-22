import { contactRagHandler, dealRagHandler } from "./crm.rag";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function ctx(grants: string[]) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) } satisfies DataSourceContext;
}

describe("contactRagHandler", () => {
  it("has sourceType 'contact'", () => {
    expect(contactRagHandler.sourceType).toBe("contact");
  });

  it("checkVisibilityAndGetName returns the name when in scope", async () => {
    const tx = { contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme Corp" }) } } as unknown as PrismaTx;
    expect(await contactRagHandler.checkVisibilityAndGetName(tx, ctx(["contact:read:tenant"]), "c1")).toBe("Acme Corp");
  });

  it("checkVisibilityAndGetName returns null with no grant at all", async () => {
    const tx = { contact: { findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme Corp" }) } } as unknown as PrismaTx;
    expect(await contactRagHandler.checkVisibilityAndGetName(tx, ctx([]), "c1")).toBeNull();
  });

  describe("checkVisibilityAndGetNames (AI Assistant Phase F — batch)", () => {
    it("returns a Map with only the contacts findMany actually returned (already RBAC-scoped)", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "c1", name: "Acme Corp" }]);
      const tx = { contact: { findMany } } as unknown as PrismaTx;

      const result = await contactRagHandler.checkVisibilityAndGetNames!(tx, ctx(["contact:read:tenant"]), ["c1", "c2"]);

      expect(result).toEqual(new Map([["c1", "Acme Corp"]]));
      expect(findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ["c1", "c2"] } });
    });

    it("returns an empty Map with no grant at all — contactsWhere returns null", async () => {
      const tx = { contact: { findMany: jest.fn() } } as unknown as PrismaTx;
      expect(await contactRagHandler.checkVisibilityAndGetNames!(tx, ctx([]), ["c1"])).toEqual(new Map());
    });
  });

  describe("extractText", () => {
    it("returns null when the contact is gone", async () => {
      const tx = { contact: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await contactRagHandler.extractText(tx, "t1", "c1")).toBeNull();
    });

    it("composes name, company, email, and phone — no free-text field exists on Contact", async () => {
      const tx = {
        contact: { findFirst: jest.fn().mockResolvedValue({ name: "Jane Doe", companyName: "Acme Corp", email: "jane@acme.com", phone: null }) },
      } as unknown as PrismaTx;
      expect(await contactRagHandler.extractText(tx, "t1", "c1")).toBe("Jane Doe, Acme Corp, jane@acme.com");
    });
  });
});

describe("dealRagHandler", () => {
  it("has sourceType 'deal'", () => {
    expect(dealRagHandler.sourceType).toBe("deal");
  });

  it("checkVisibilityAndGetName returns the title when in scope", async () => {
    const tx = { deal: { findFirst: jest.fn().mockResolvedValue({ id: "d1", title: "Renewal" }) } } as unknown as PrismaTx;
    expect(await dealRagHandler.checkVisibilityAndGetName(tx, ctx(["deal:read:tenant"]), "d1")).toBe("Renewal");
  });

  describe("checkVisibilityAndGetNames (AI Assistant Phase F — batch)", () => {
    it("returns a Map with only the deals findMany actually returned (already RBAC-scoped)", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "d1", title: "Renewal" }]);
      const tx = { deal: { findMany } } as unknown as PrismaTx;

      const result = await dealRagHandler.checkVisibilityAndGetNames!(tx, ctx(["deal:read:tenant"]), ["d1", "d2"]);

      expect(result).toEqual(new Map([["d1", "Renewal"]]));
      expect(findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ["d1", "d2"] } });
    });

    it("returns an empty Map with no grant at all — dealsWhere returns null", async () => {
      const tx = { deal: { findMany: jest.fn() } } as unknown as PrismaTx;
      expect(await dealRagHandler.checkVisibilityAndGetNames!(tx, ctx([]), ["d1"])).toEqual(new Map());
    });
  });

  describe("extractText", () => {
    it("returns null when the deal is gone", async () => {
      const tx = { deal: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await dealRagHandler.extractText(tx, "t1", "d1")).toBeNull();
    });

    it("composes title, stage, and the linked contact's name/company", async () => {
      const tx = {
        deal: { findFirst: jest.fn().mockResolvedValue({ title: "Renewal", stage: "proposal", contact: { name: "Jane Doe", companyName: "Acme Corp" } }) },
      } as unknown as PrismaTx;
      expect(await dealRagHandler.extractText(tx, "t1", "d1")).toBe("Renewal (proposal) — Jane Doe at Acme Corp");
    });
  });
});
