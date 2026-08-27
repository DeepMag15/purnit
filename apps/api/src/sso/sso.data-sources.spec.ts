import { ssoGetDataSource } from "./sso.data-sources";

function makeCtx() {
  return { tenantId: "t1" } as any;
}

describe("sso.get", () => {
  it("returns a safe null-ish shape before sso.configure has ever been called for this tenant", async () => {
    const tx = { ssoConfig: { findUnique: jest.fn().mockResolvedValue(null) } } as any;

    const result = await ssoGetDataSource.resolve({}, makeCtx(), tx);

    expect(result).toEqual({ enabled: false, idpAlias: null, displayName: null, defaultRoleId: null, requireEmailVerified: true });
  });

  it("returns the configured row's fields, scoped by the tenant's own findUnique", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: "cfg1",
      tenantId: "t1",
      enabled: true,
      idpAlias: "idp-t1",
      displayName: "Okta",
      defaultRoleId: "role-1",
      requireEmailVerified: true,
    });
    const tx = { ssoConfig: { findUnique } } as any;

    const result = await ssoGetDataSource.resolve({}, makeCtx(), tx);

    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
    expect(result).toEqual({ enabled: true, idpAlias: "idp-t1", displayName: "Okta", defaultRoleId: "role-1", requireEmailVerified: true });
  });
});
