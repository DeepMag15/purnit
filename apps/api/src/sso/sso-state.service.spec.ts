import { SsoStateService } from "./sso-state.service";

describe("SsoStateService", () => {
  beforeEach(() => {
    process.env.SSO_STATE_SECRET = "test-secret";
  });

  it("round-trips a signed payload", () => {
    const service = new SsoStateService();
    const token = service.sign({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2" });
    const payload = service.verify(token);
    expect(payload).toMatchObject({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2" });
  });

  it("rejects a tampered payload", () => {
    const service = new SsoStateService();
    const token = service.sign({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2" });
    const [, signature] = token.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({ tenantId: "attacker", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2", exp: 9999999999 }),
    ).toString("base64url");
    expect(() => service.verify(`${tamperedBody}.${signature}`)).toThrow(/signature/);
  });

  it("rejects an expired token", () => {
    const service = new SsoStateService();
    const realNow = Date.now;
    Date.now = () => new Date("2020-01-01").getTime();
    const token = service.sign({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2" });
    Date.now = realNow;
    expect(() => service.verify(token)).toThrow(/expired/);
  });

  it("rejects a token signed with a different secret", () => {
    const service1 = new SsoStateService();
    const token = service1.sign({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2" });
    process.env.SSO_STATE_SECRET = "different-secret";
    const service2 = new SsoStateService();
    expect(() => service2.verify(token)).toThrow(/signature/);
  });

  it("rejects a malformed token", () => {
    const service = new SsoStateService();
    expect(() => service.verify("not-a-valid-token")).toThrow(/Malformed/);
  });

  it("throws a clear error when SSO_STATE_SECRET is unset, deferred to first real use", () => {
    delete process.env.SSO_STATE_SECRET;
    const service = new SsoStateService();
    expect(() => service.sign({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n1", csrfNonce: "n2" })).toThrow(/not configured/);
  });
});
