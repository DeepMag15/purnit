import { BadRequestException } from "@nestjs/common";
import { SsoController } from "./sso.controller";
import type { TenantPrismaService } from "../tenancy/tenant-prisma.service";
import type { SsoStateService } from "./sso-state.service";
import type { SsoBrokerService } from "./sso-broker.service";
import type { SsoJitProvisionService } from "./sso-jit-provision.service";

function fakeRes() {
  return { cookie: jest.fn(), clearCookie: jest.fn(), redirect: jest.fn() } as any;
}

function fakeReq(cookieHeader?: string) {
  return { headers: { cookie: cookieHeader } } as any;
}

function fakeTenantPrisma(params: { tenant?: { id: string; workspaceId: string } | null; config?: unknown }) {
  return {
    root: { tenant: { findUnique: jest.fn().mockResolvedValue(params.tenant ?? null) } },
    run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({ ssoConfig: { findUnique: jest.fn().mockResolvedValue(params.config ?? null) } }),
    ),
  } as unknown as TenantPrismaService;
}

describe("SsoController", () => {
  describe("workspaceSsoStatus", () => {
    it("returns false for an unknown workspace", async () => {
      const controller = new SsoController(
        fakeTenantPrisma({ tenant: null }),
        {} as SsoStateService,
        {} as SsoBrokerService,
        {} as SsoJitProvisionService,
      );
      expect(await controller.workspaceSsoStatus({ workspaceId: "nope" })).toEqual({ ssoEnabled: false });
    });

    it("returns false when SSO is disabled — indistinguishable from an unknown workspace", async () => {
      const controller = new SsoController(
        fakeTenantPrisma({ tenant: { id: "t1", workspaceId: "acme" }, config: { enabled: false, idpAlias: "idp-t1" } }),
        {} as SsoStateService,
        {} as SsoBrokerService,
        {} as SsoJitProvisionService,
      );
      expect(await controller.workspaceSsoStatus({ workspaceId: "acme" })).toEqual({ ssoEnabled: false });
    });

    it("returns true when SSO is enabled and has an idpAlias", async () => {
      const controller = new SsoController(
        fakeTenantPrisma({ tenant: { id: "t1", workspaceId: "acme" }, config: { enabled: true, idpAlias: "idp-t1" } }),
        {} as SsoStateService,
        {} as SsoBrokerService,
        {} as SsoJitProvisionService,
      );
      expect(await controller.workspaceSsoStatus({ workspaceId: "acme" })).toEqual({ ssoEnabled: true });
    });
  });

  describe("authorize", () => {
    it("400s on an unknown workspace", async () => {
      const controller = new SsoController(
        fakeTenantPrisma({ tenant: null }),
        {} as SsoStateService,
        {} as SsoBrokerService,
        {} as SsoJitProvisionService,
      );
      await expect(controller.authorize({ workspaceId: "nope" }, fakeRes())).rejects.toThrow(BadRequestException);
    });

    it("400s when SSO is not enabled — same error as an unknown workspace", async () => {
      const controller = new SsoController(
        fakeTenantPrisma({ tenant: { id: "t1", workspaceId: "acme" }, config: { enabled: false, idpAlias: null } }),
        {} as SsoStateService,
        {} as SsoBrokerService,
        {} as SsoJitProvisionService,
      );
      await expect(controller.authorize({ workspaceId: "acme" }, fakeRes())).rejects.toThrow(BadRequestException);
    });

    it("sets a CSRF cookie and redirects to the broker's authorization URL", async () => {
      const state = {
        generateCsrfNonce: jest.fn().mockReturnValue("csrf-1"),
        sign: jest.fn().mockReturnValue("state-token-1"),
      } as unknown as SsoStateService;
      const broker = {
        generateCodeVerifier: jest.fn().mockReturnValue("verifier-1"),
        generateNonce: jest.fn().mockReturnValue("nonce-1"),
        buildAuthorizationUrl: jest.fn().mockResolvedValue("https://keycloak.example/auth?kc_idp_hint=idp-t1"),
      } as unknown as SsoBrokerService;
      const controller = new SsoController(
        fakeTenantPrisma({ tenant: { id: "t1", workspaceId: "acme" }, config: { enabled: true, idpAlias: "idp-t1" } }),
        state,
        broker,
        {} as SsoJitProvisionService,
      );
      const res = fakeRes();

      await controller.authorize({ workspaceId: "acme" }, res);

      expect(res.cookie).toHaveBeenCalledWith("sso_csrf", "csrf-1", expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
      expect(broker.buildAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ idpAlias: "idp-t1", state: "state-token-1", nonce: "nonce-1", codeVerifier: "verifier-1" }),
      );
      expect(res.redirect).toHaveBeenCalledWith("https://keycloak.example/auth?kc_idp_hint=idp-t1");
    });
  });

  describe("callback", () => {
    it("redirects to /login?error=sso_failed when code or state is missing", async () => {
      const controller = new SsoController(
        fakeTenantPrisma({}),
        {} as SsoStateService,
        {} as SsoBrokerService,
        {} as SsoJitProvisionService,
      );
      const res = fakeRes();

      await controller.callback({}, fakeReq(), res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("/login?error=sso_failed"));
    });

    it("rejects a CSRF-cookie mismatch without ever exchanging the code — the real defense against OAuth login-CSRF", async () => {
      const state = {
        verify: jest.fn().mockReturnValue({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n", csrfNonce: "expected-csrf", exp: 9999999999 }),
      } as unknown as SsoStateService;
      const broker = { exchangeCode: jest.fn() } as unknown as SsoBrokerService;
      const controller = new SsoController(fakeTenantPrisma({}), state, broker, {} as SsoJitProvisionService);
      const res = fakeRes();

      await controller.callback({ code: "code-1", state: "state-1" }, fakeReq("sso_csrf=wrong-csrf"), res);

      expect(broker.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("/login?error=sso_failed"));
    });

    it("rejects a tampered/expired state token cleanly, never a raw 500", async () => {
      const state = {
        verify: jest.fn().mockImplementation(() => {
          throw new Error("SSO state has expired");
        }),
      } as unknown as SsoStateService;
      const controller = new SsoController(fakeTenantPrisma({}), state, {} as SsoBrokerService, {} as SsoJitProvisionService);
      const res = fakeRes();

      await controller.callback({ code: "code-1", state: "state-1" }, fakeReq(), res);

      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("/login?error=sso_failed"));
    });

    it("rejects when SSO was disabled mid-flow (re-fetched fresh, not trusted from the signed state)", async () => {
      const state = {
        verify: jest.fn().mockReturnValue({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n", csrfNonce: "csrf-1", exp: 9999999999 }),
      } as unknown as SsoStateService;
      const broker = { exchangeCode: jest.fn() } as unknown as SsoBrokerService;
      const controller = new SsoController(
        fakeTenantPrisma({ config: { enabled: false, idpAlias: "idp-t1" } }),
        state,
        broker,
        {} as SsoJitProvisionService,
      );
      const res = fakeRes();

      await controller.callback({ code: "code-1", state: "state-1" }, fakeReq("sso_csrf=csrf-1"), res);

      expect(broker.exchangeCode).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining("/login?error=sso_failed"));
    });

    it("on success, redirects to /login/sso-callback with tokens in the URL fragment, never a query param", async () => {
      const state = {
        verify: jest.fn().mockReturnValue({ tenantId: "t1", codeVerifier: "v", oidcNonce: "n", csrfNonce: "csrf-1", exp: 9999999999 }),
      } as unknown as SsoStateService;
      const broker = { exchangeCode: jest.fn().mockResolvedValue({ email: "a@b.com", emailVerified: true }) } as unknown as SsoBrokerService;
      const jitProvision = {
        provisionAndFederate: jest.fn().mockResolvedValue({ accessToken: "at-1", refreshToken: "rt-1" }),
      } as unknown as SsoJitProvisionService;
      const controller = new SsoController(
        fakeTenantPrisma({ config: { enabled: true, idpAlias: "idp-t1" } }),
        state,
        broker,
        jitProvision,
      );
      const res = fakeRes();

      await controller.callback({ code: "code-1", state: "state-1" }, fakeReq("sso_csrf=csrf-1"), res);

      const redirectUrl = res.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain("/login/sso-callback#access_token=at-1&refresh_token=rt-1");
      expect(redirectUrl).not.toMatch(/\?.*access_token/);
      expect(res.clearCookie).toHaveBeenCalledWith("sso_csrf", expect.objectContaining({ path: "/auth/sso/callback" }));
    });
  });
});
