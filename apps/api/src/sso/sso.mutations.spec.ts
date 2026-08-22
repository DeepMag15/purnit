import { BadRequestException } from "@nestjs/common";
import { ssoConfigureMutation } from "./sso.mutations";

function makeCtx() {
  return { tenantId: "t1", userId: "u1" } as any;
}

describe("sso.configure", () => {
  it("generates idpAlias deterministically ('idp-<tenantId>') on first create", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "cfg1", enabled: true, defaultRoleId: "role-1" });
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "role-1" }) },
      ssoConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any;

    await ssoConfigureMutation.resolve({ enabled: true, defaultRoleId: "role-1" }, makeCtx(), tx);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t1" },
        create: expect.objectContaining({ tenantId: "t1", idpAlias: "idp-t1" }),
      }),
    );
  });

  it("never regenerates idpAlias on update — the whole point is it stays stable and unique", async () => {
    const upsert = jest.fn().mockResolvedValue({ id: "cfg1", enabled: true, defaultRoleId: null });
    const tx = {
      role: { findFirst: jest.fn() },
      ssoConfig: { findUnique: jest.fn().mockResolvedValue({ id: "cfg1", idpAlias: "idp-t1", enabled: false, defaultRoleId: null }), upsert },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any;

    await ssoConfigureMutation.resolve({ enabled: true }, makeCtx(), tx);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ idpAlias: "idp-t1" }) }));
  });

  it("leaves displayName/defaultRoleId untouched on update when omitted from input", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const tx = {
      role: { findFirst: jest.fn() },
      ssoConfig: { findUnique: jest.fn().mockResolvedValue({ id: "cfg1", idpAlias: "idp-t1", enabled: false, defaultRoleId: "role-1" }), upsert },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as any;

    await ssoConfigureMutation.resolve({ enabled: true }, makeCtx(), tx);

    const call = upsert.mock.calls[0][0];
    expect(call.update.displayName).toBeUndefined();
    expect(call.update.defaultRoleId).toBeUndefined();
  });

  it("rejects a defaultRoleId from another tenant, never reaching ssoConfig.upsert", async () => {
    const roleFindFirst = jest.fn().mockResolvedValue(null);
    const upsert = jest.fn();
    const tx = { role: { findFirst: roleFindFirst }, ssoConfig: { findUnique: jest.fn(), upsert }, auditLog: { create: jest.fn() } } as any;

    await expect(ssoConfigureMutation.resolve({ enabled: true, defaultRoleId: "other-tenant-role" }, makeCtx(), tx)).rejects.toThrow(
      BadRequestException,
    );
    expect(roleFindFirst).toHaveBeenCalledWith({ where: { id: "other-tenant-role", tenantId: "t1" } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes an audit log entry", async () => {
    const auditLogCreate = jest.fn().mockResolvedValue({});
    const tx = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: "role-1" }) },
      ssoConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: "cfg1", enabled: true, defaultRoleId: "role-1" }) },
      auditLog: { create: auditLogCreate },
    } as any;

    await ssoConfigureMutation.resolve({ enabled: true, defaultRoleId: "role-1" }, makeCtx(), tx);

    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "sso.configure", resource: "ssoConfig" }) }),
    );
  });
});
