import { collapsePermissions } from "../../rbac/permission-collapse";
import { clientsWhere, salesRepOwnedClientIds, clientsListDataSource, clientDetailDataSource } from "./clients.data-sources";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[], userId = "u1"): DataSourceContext {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("clientsWhere", () => {
  it("returns null for an actor with no client:read grant at all", async () => {
    const tx = {} as unknown as PrismaTx;
    expect(await clientsWhere(tx, context([]))).toBeNull();
  });

  it("returns an unrestricted where at tenant scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await clientsWhere(tx, context(["client:read:tenant"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null });
  });

  it("resolves :own to accountManagerId — a real, non-inert scope", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await clientsWhere(tx, context(["client:read:own"]));
    expect(where).toEqual({ tenantId: "t1", deletedAt: null, accountManagerId: "u1" });
  });

  it("layers an extra where clause on top of the scope condition", async () => {
    const tx = {} as unknown as PrismaTx;
    const where = await clientsWhere(tx, context(["client:read:tenant"]), { status: "active" });
    expect(where).toMatchObject({ status: "active" });
  });
});

describe("salesRepOwnedClientIds", () => {
  it("queries by direct accountManagerId ownership, never by delegating to clientsWhere's own tenant-wide branch", async () => {
    // Regression guard for the single most important distinction in this
    // domain (see this function's own doc comment): even an actor holding
    // client:read:tenant (which would make clientsWhere return every client
    // in the tenant) must only get back clients they actually own here.
    const findMany = jest.fn().mockResolvedValue([{ id: "c1" }, { id: "c2" }]);
    const tx = { client: { findMany } } as unknown as PrismaTx;

    const ids = await salesRepOwnedClientIds(tx, { tenantId: "t1", userId: "u1" });
    expect(ids).toEqual(["c1", "c2"]);
    expect(findMany.mock.calls[0]![0].where).toEqual({ tenantId: "t1", accountManagerId: "u1", deletedAt: null });
  });

  it("accepts an explicit accountManagerId override, independent of ctx.userId", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { client: { findMany } } as unknown as PrismaTx;

    await salesRepOwnedClientIds(tx, { tenantId: "t1", userId: "u1" }, "other-rep");
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ accountManagerId: "other-rep" });
  });
});

describe("clients.list", () => {
  it("returns [] when the actor has no client:read grant", async () => {
    const tx = { client: { findMany: jest.fn() } } as unknown as PrismaTx;
    expect(await clientsListDataSource.resolve({}, context([]), tx)).toEqual([]);
  });

  it("joins accountManagerName and invoiceCount", async () => {
    const tx = {
      client: { findMany: jest.fn().mockResolvedValue([{ id: "c1", accountManagerId: "u2" }]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2", displayName: "Rep Two" }]) },
      invoice: { groupBy: jest.fn().mockResolvedValue([{ clientId: "c1", _count: { clientId: 4 } }]) },
    } as unknown as PrismaTx;

    const rows = (await clientsListDataSource.resolve({}, context(["client:read:tenant"]), tx)) as {
      id: string;
      accountManagerName: string | null;
      invoiceCount: number;
    }[];
    expect(rows).toEqual([{ id: "c1", accountManagerId: "u2", accountManagerName: "Rep Two", invoiceCount: 4 }]);
  });
});

describe("clients.detail", () => {
  function detailTx(overrides: Partial<{ projectFindFirst: jest.Mock }> = {}) {
    return {
      client: { findFirst: jest.fn().mockResolvedValue({ id: "c1", accountManagerId: null, filesProjectId: "proj1" }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: { count: jest.fn().mockResolvedValue(0) },
      project: { findFirst: overrides.projectFindFirst ?? jest.fn() },
    } as unknown as PrismaTx;
  }

  it("throws NotFoundException for a client that doesn't exist or is out of scope", async () => {
    const tx = { client: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(clientDetailDataSource.resolve({ id: "ghost" }, context(["client:read:tenant"]), tx)).rejects.toThrow("No client");
  });

  describe("filesVisible", () => {
    it("is true for an actor holding project:read:tenant", async () => {
      const tx = detailTx({ projectFindFirst: jest.fn().mockResolvedValue({ id: "proj1" }) });
      const data = (await clientDetailDataSource.resolve({ id: "c1" }, context(["client:read:tenant", "project:read:tenant"]), tx)) as {
        filesVisible: boolean;
      };
      expect(data.filesVisible).toBe(true);
    });

    it("is false for an actor with client:read but zero project:read at all (Billing Clerk-shaped)", async () => {
      const tx = detailTx();
      const data = (await clientDetailDataSource.resolve({ id: "c1" }, context(["client:read:tenant", "invoice:create:tenant"]), tx)) as {
        filesVisible: boolean;
      };
      expect(data.filesVisible).toBe(false);
      expect((tx as unknown as { project: { findFirst: jest.Mock } }).project.findFirst).not.toHaveBeenCalled();
    });

    it("is false when project:read:own is held but doesn't reach this client's own files project", async () => {
      const tx = detailTx({ projectFindFirst: jest.fn().mockResolvedValue(null) });
      const data = (await clientDetailDataSource.resolve({ id: "c1" }, context(["client:read:tenant", "project:read:own"]), tx)) as {
        filesVisible: boolean;
      };
      expect(data.filesVisible).toBe(false);
    });
  });
});
