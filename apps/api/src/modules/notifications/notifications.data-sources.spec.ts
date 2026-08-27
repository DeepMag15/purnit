import { notificationsListDataSource, notificationsUnreadCountDataSource } from "./notifications.data-sources";

function makeCtx() {
  return { tenantId: "t1", userId: "u1" } as any;
}

describe("notifications.list", () => {
  it("defaults to page 0, take 20, no type filter — unchanged from the bell dropdown's original call shape", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { notification: { findMany } } as any;

    await notificationsListDataSource.resolve({}, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", userId: "u1" },
      orderBy: { createdAt: "desc" },
      take: 20,
      skip: 0,
    });
  });

  it("computes skip from page", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { notification: { findMany } } as any;

    await notificationsListDataSource.resolve({ page: 2 }, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, skip: 40 }));
  });

  it("filters by type when given", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { notification: { findMany } } as any;

    await notificationsListDataSource.resolve({ type: "task.assigned" }, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "t1", userId: "u1", type: "task.assigned" } }));
  });

  it("combines unreadOnly and type filters", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { notification: { findMany } } as any;

    await notificationsListDataSource.resolve({ unreadOnly: true, type: "leave.submitted" }, makeCtx(), tx);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", userId: "u1", readAt: null, type: "leave.submitted" } }),
    );
  });
});

describe("notifications.unreadCount", () => {
  it("counts only this user's unread rows in this tenant", async () => {
    const count = jest.fn().mockResolvedValue(3);
    const tx = { notification: { count } } as any;

    const result = await notificationsUnreadCountDataSource.resolve({}, makeCtx(), tx);

    expect(count).toHaveBeenCalledWith({ where: { tenantId: "t1", userId: "u1", readAt: null } });
    expect(result).toBe(3);
  });
});
