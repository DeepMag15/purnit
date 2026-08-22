import { SsoBrokerService } from "./sso-broker.service";

const mockAuthorizationUrl = jest.fn();
const mockCallback = jest.fn();
const mockDiscover = jest.fn();
const mockCodeVerifier = jest.fn();
const mockCodeChallenge = jest.fn();
const mockNonce = jest.fn();

// Same hoisting reasoning as billing/stripe.service.spec.ts's own jest.mock
// for the "stripe" SDK — ts-jest defers invoking this factory until the
// module is actually imported, by which point the outer `mock*` consts
// above have already been assigned.
jest.mock("openid-client", () => ({
  Issuer: { discover: (...args: unknown[]) => mockDiscover(...args) },
  generators: {
    codeVerifier: (...args: unknown[]) => mockCodeVerifier(...args),
    codeChallenge: (...args: unknown[]) => mockCodeChallenge(...args),
    nonce: (...args: unknown[]) => mockNonce(...args),
  },
}));

describe("SsoBrokerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KEYCLOAK_ISSUER_URL = "https://keycloak.example/realms/purnit";
    process.env.KEYCLOAK_CLIENT_ID = "purnit-api";
    process.env.KEYCLOAK_CLIENT_SECRET = "secret";
    mockCodeVerifier.mockReturnValue("verifier-123");
    mockCodeChallenge.mockReturnValue("challenge-123");
    mockNonce.mockReturnValue("nonce-123");

    class FakeClient {
      authorizationUrl = mockAuthorizationUrl;
      callback = mockCallback;
    }
    mockDiscover.mockResolvedValue({ Client: FakeClient });
  });

  describe("lazy client construction", () => {
    it("constructing the service never throws even with no Keycloak env configured", () => {
      delete process.env.KEYCLOAK_ISSUER_URL;
      expect(() => new SsoBrokerService()).not.toThrow();
    });

    it("a real call with no Keycloak env configured throws a clear, addressable error", async () => {
      delete process.env.KEYCLOAK_ISSUER_URL;
      const service = new SsoBrokerService();
      await expect(
        service.buildAuthorizationUrl({ idpAlias: "idp-1", redirectUri: "https://api/cb", state: "s", nonce: "n", codeVerifier: "v" }),
      ).rejects.toThrow(/not configured/);
    });
  });

  describe("buildAuthorizationUrl", () => {
    it("embeds kc_idp_hint and a PKCE S256 challenge", async () => {
      mockAuthorizationUrl.mockReturnValue("https://keycloak.example/auth?mock=1");
      const service = new SsoBrokerService();
      const url = await service.buildAuthorizationUrl({
        idpAlias: "idp-t1",
        redirectUri: "https://api/auth/sso/callback",
        state: "state-token",
        nonce: "nonce-123",
        codeVerifier: "verifier-123",
      });

      expect(url).toBe("https://keycloak.example/auth?mock=1");
      expect(mockCodeChallenge).toHaveBeenCalledWith("verifier-123");
      expect(mockAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          kc_idp_hint: "idp-t1",
          code_challenge: "challenge-123",
          code_challenge_method: "S256",
          state: "state-token",
          nonce: "nonce-123",
          redirect_uri: "https://api/auth/sso/callback",
        }),
      );
    });
  });

  describe("exchangeCode", () => {
    it("returns email/emailVerified/name claims from the exchanged token set", async () => {
      mockCallback.mockResolvedValue({ claims: () => ({ email: "a@b.com", email_verified: true, name: "A B" }) });
      const service = new SsoBrokerService();
      const claims = await service.exchangeCode({
        redirectUri: "https://api/auth/sso/callback",
        callbackParams: { code: "code-1", state: "state-1", iss: "https://keycloak.example/realms/purnit" },
        state: "state-1",
        codeVerifier: "verifier-123",
        nonce: "nonce-123",
      });
      expect(claims).toEqual({ email: "a@b.com", emailVerified: true, name: "A B" });
      // The full raw callback query is forwarded as-is, not a hand-picked
      // {code, state} subset — see exchangeCode's own doc comment for why
      // (openid-client's RFC 9207 `iss` check, found live during E2E
      // verification when Keycloak's own redirect included `iss` and a
      // narrower params object silently dropped it).
      expect(mockCallback).toHaveBeenCalledWith(
        "https://api/auth/sso/callback",
        { code: "code-1", state: "state-1", iss: "https://keycloak.example/realms/purnit" },
        { code_verifier: "verifier-123", state: "state-1", nonce: "nonce-123" },
      );
    });

    it("defaults emailVerified to false and name to undefined when absent", async () => {
      mockCallback.mockResolvedValue({ claims: () => ({ email: "a@b.com" }) });
      const service = new SsoBrokerService();
      const claims = await service.exchangeCode({
        redirectUri: "https://api/cb",
        callbackParams: { code: "c", state: "s" },
        state: "s",
        codeVerifier: "v",
        nonce: "n",
      });
      expect(claims).toEqual({ email: "a@b.com", emailVerified: false, name: undefined });
    });

    it("throws when the identity provider never asserted an email claim", async () => {
      mockCallback.mockResolvedValue({ claims: () => ({ email_verified: true }) });
      const service = new SsoBrokerService();
      await expect(
        service.exchangeCode({ redirectUri: "https://api/cb", callbackParams: { code: "c", state: "s" }, state: "s", codeVerifier: "v", nonce: "n" }),
      ).rejects.toThrow(/email/);
    });
  });
});
