import { auditLogsListDataSource } from "./audit.data-sources";

function makeCtx() {
  return { tenantId: "t1", userId: "u1" } as any;
}

const SAMPLE_ROW = {
  id: "log1",
  actorUserId: "actor1",
  action: "role.delete",
  resource: "role",
  resourceId: "r1",
  before: { label: "Old" },
  after: null,
  createdAt: new Date("2026-08-14T00:00:00Z"),
};

describe("auditLogs.list", () => {
  it("defaults to page 0, take 30, tenant-scoped, no filters", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { auditLog: { findMany }, user: { findMany: jest.fn() } } as any;

    await auditLogsListDataSource.resolve({}, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1" },
      orderBy: { createdAt: "desc" },
      take: 30,
      skip: 0,
    });
  });

  it("computes skip from page", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { auditLog: { findMany }, user: { findMany: jest.fn() } } as any;

    await auditLogsListDataSource.resolve({ page: 2 }, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 30, skip: 60 }));
  });

  it("filters by resource/action/actorUserId when given", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { auditLog: { findMany }, user: { findMany: jest.fn() } } as any;

    await auditLogsListDataSource.resolve({ resource: "role", action: "delete", actorUserId: "u9" }, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", resource: "role", action: "delete", actorUserId: "u9" } }),
    );
  });

  it("resolves the actor's display name and shapes the row", async () => {
    const findMany = jest.fn().mockResolvedValue([SAMPLE_ROW]);
    const userFindMany = jest.fn().mockResolvedValue([{ id: "actor1", displayName: "Alex Morgan" }]);
    const tx = { auditLog: { findMany }, user: { findMany: userFindMany } } as any;

    const result = await auditLogsListDataSource.resolve({}, makeCtx(), tx);

    expect(userFindMany).toHaveBeenCalledWith({ where: { id: { in: ["actor1"] } }, select: { id: true, displayName: true } });
    expect(result).toEqual([
      {
        id: "log1",
        actorUserId: "actor1",
        actorName: "Alex Morgan",
        action: "role.delete",
        resource: "role",
        resourceId: "r1",
        before: { label: "Old" },
        after: null,
        createdAt: SAMPLE_ROW.createdAt,
      },
    ]);
  });

  it("falls back to a placeholder name for a since-deleted actor", async () => {
    const findMany = jest.fn().mockResolvedValue([SAMPLE_ROW]);
    const userFindMany = jest.fn().mockResolvedValue([]);
    const tx = { auditLog: { findMany }, user: { findMany: userFindMany } } as any;

    const result = (await auditLogsListDataSource.resolve({}, makeCtx(), tx)) as { actorName: string }[];

    expect(result[0].actorName).toBe("Deleted user");
  });

  it("skips the user lookup entirely when there are no rows", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const userFindMany = jest.fn();
    const tx = { auditLog: { findMany }, user: { findMany: userFindMany } } as any;

    await auditLogsListDataSource.resolve({}, makeCtx(), tx);

    expect(userFindMany).not.toHaveBeenCalled();
  });
});
