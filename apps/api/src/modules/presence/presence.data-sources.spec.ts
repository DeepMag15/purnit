import { presenceListDataSource } from "./presence.data-sources";

function makeCtx() {
  return { tenantId: "t1", userId: "actor" } as any;
}

describe("presence.list", () => {
  it("scopes the lookup to the given userIds within the actor's tenant", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { user: { findMany } } as any;

    await presenceListDataSource.resolve({ userIds: ["u1", "u2"] }, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["u1", "u2"] }, tenantId: "t1" },
      select: { id: true, lastSeenAt: true, presenceStatus: true },
    });
  });

  it("derives online for a lastSeenAt within the last 2 minutes", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "u1", lastSeenAt: new Date(Date.now() - 30_000), presenceStatus: null }]);
    const tx = { user: { findMany } } as any;

    const result = await presenceListDataSource.resolve({ userIds: ["u1"] }, makeCtx(), tx);

    expect(result).toEqual([{ userId: "u1", status: "online" }]);
  });

  it("derives away for a lastSeenAt between 2 and 10 minutes ago", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "u1", lastSeenAt: new Date(Date.now() - 5 * 60_000), presenceStatus: null }]);
    const tx = { user: { findMany } } as any;

    const result = await presenceListDataSource.resolve({ userIds: ["u1"] }, makeCtx(), tx);

    expect(result).toEqual([{ userId: "u1", status: "away" }]);
  });

  it("derives offline for a lastSeenAt over 10 minutes ago", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "u1", lastSeenAt: new Date(Date.now() - 20 * 60_000), presenceStatus: null }]);
    const tx = { user: { findMany } } as any;

    const result = await presenceListDataSource.resolve({ userIds: ["u1"] }, makeCtx(), tx);

    expect(result).toEqual([{ userId: "u1", status: "offline" }]);
  });

  it("derives offline for a user who has never heartbeat (lastSeenAt null)", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "u1", lastSeenAt: null, presenceStatus: null }]);
    const tx = { user: { findMany } } as any;

    const result = await presenceListDataSource.resolve({ userIds: ["u1"] }, makeCtx(), tx);

    expect(result).toEqual([{ userId: "u1", status: "offline" }]);
  });

  it("an explicit presenceStatus override always wins over the derived status", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "u1", lastSeenAt: new Date(), presenceStatus: "busy" }]);
    const tx = { user: { findMany } } as any;

    const result = await presenceListDataSource.resolve({ userIds: ["u1"] }, makeCtx(), tx);

    expect(result).toEqual([{ userId: "u1", status: "busy" }]);
  });
});
