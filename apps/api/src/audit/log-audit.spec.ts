import { logAudit } from "./log-audit";

function makeCtx() {
  return { tenantId: "t1", userId: "actor" } as any;
}

describe("logAudit", () => {
  it("writes a row scoped to the actor's tenant and userId", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { auditLog: { create } } as any;

    await logAudit(tx, makeCtx(), { action: "role.delete", resource: "role", resourceId: "r1" });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1",
        actorUserId: "actor",
        action: "role.delete",
        resource: "role",
        resourceId: "r1",
        before: undefined,
        after: undefined,
      },
    });
  });

  it("passes through before/after when given", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { auditLog: { create } } as any;

    await logAudit(tx, makeCtx(), { action: "role.updateCustom", resource: "role", resourceId: "r1", before: { label: "Old" }, after: { label: "New" } });

    expect(create.mock.calls[0][0].data.before).toEqual({ label: "Old" });
    expect(create.mock.calls[0][0].data.after).toEqual({ label: "New" });
  });

  it("omits resourceId when not given", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = { auditLog: { create } } as any;

    await logAudit(tx, makeCtx(), { action: "tenant.updateBranding", resource: "tenant" });

    expect(create.mock.calls[0][0].data.resourceId).toBeUndefined();
  });
});
