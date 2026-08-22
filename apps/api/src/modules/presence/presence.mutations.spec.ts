import { presenceHeartbeatMutation } from "./presence.mutations";

function makeCtx() {
  return { tenantId: "t1", userId: "u1" } as any;
}

describe("presence.heartbeat", () => {
  it("bumps only lastSeenAt when no presenceStatus is sent", async () => {
    const update = jest.fn().mockResolvedValue({ id: "u1", lastSeenAt: new Date(), presenceStatus: null });
    const tx = { user: { update } } as any;

    await presenceHeartbeatMutation.resolve({}, makeCtx(), tx);

    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "u1" });
    expect(call.data.lastSeenAt).toBeInstanceOf(Date);
    expect("presenceStatus" in call.data).toBe(false);
  });

  it("sets an explicit presenceStatus override when given", async () => {
    const update = jest.fn().mockResolvedValue({ id: "u1", lastSeenAt: new Date(), presenceStatus: "away" });
    const tx = { user: { update } } as any;

    await presenceHeartbeatMutation.resolve({ presenceStatus: "away" }, makeCtx(), tx);

    expect(update.mock.calls[0][0].data.presenceStatus).toBe("away");
  });

  it("clears an override when presenceStatus is explicitly null", async () => {
    const update = jest.fn().mockResolvedValue({ id: "u1", lastSeenAt: new Date(), presenceStatus: null });
    const tx = { user: { update } } as any;

    await presenceHeartbeatMutation.resolve({ presenceStatus: null }, makeCtx(), tx);

    expect(update.mock.calls[0][0].data.presenceStatus).toBeNull();
  });

  it("only ever updates the calling user's own row", async () => {
    const update = jest.fn().mockResolvedValue({ id: "actor", lastSeenAt: new Date(), presenceStatus: null });
    const tx = { user: { update } } as any;

    await presenceHeartbeatMutation.resolve({}, { tenantId: "t1", userId: "actor" } as any, tx);

    expect(update.mock.calls[0][0].where).toEqual({ id: "actor" });
  });
});
