import { Injectable } from "@nestjs/common";
import { generators, Issuer, type Client } from "openid-client";

export interface BrokerClaims {
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Thin `openid-client` wrapper — the ONLY place in this codebase that
 * speaks OIDC to Keycloak. Deliberately never speaks SAML: Keycloak itself
 * is configured (per tenant, via its own Admin Console — see
 * infra/keycloak/README.md) with an Identity Provider that can be either
 * SAML 2.0 or OIDC upstream, absorbing all SAML/XML complexity on its own
 * side. Pinned to `openid-client` v5, not v6 — v6 is pure ESM and this
 * repo's API compiles to CommonJS on Node 22.11.0, just below the
 * `require(esm)` interop threshold (`^22.12.0`); v5 is dual CJS/ESM with
 * zero interop friction and everything authorization-code+PKCE needs.
 *
 * Lazily constructed (`resolveClient`), not built eagerly at DI-construction
 * time — same principle `AiProviderService`/`StripeService` already
 * established: a missing/misconfigured Keycloak shouldn't crash the whole
 * API at boot, only fail the first real SSO attempt with a clear error.
 */
@Injectable()
export class SsoBrokerService {
  private client: Client | null = null;

  private async resolveClient(): Promise<Client> {
    if (this.client) return this.client;

    const issuerUrl = process.env.KEYCLOAK_ISSUER_URL;
    const clientId = process.env.KEYCLOAK_CLIENT_ID;
    const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
    if (!issuerUrl || !clientId || !clientSecret) {
      throw new Error(
        "Enterprise SSO is not configured — set KEYCLOAK_ISSUER_URL/KEYCLOAK_CLIENT_ID/KEYCLOAK_CLIENT_SECRET to enable it.",
      );
    }

    const issuer = await Issuer.discover(issuerUrl);
    this.client = new issuer.Client({ client_id: clientId, client_secret: clientSecret, response_types: ["code"] });
    return this.client;
  }

  generateCodeVerifier(): string {
    return generators.codeVerifier();
  }

  generateNonce(): string {
    return generators.nonce();
  }

  async buildAuthorizationUrl(opts: {
    idpAlias: string;
    redirectUri: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<string> {
    const client = await this.resolveClient();
    return client.authorizationUrl({
      redirect_uri: opts.redirectUri,
      scope: "openid email profile",
      state: opts.state,
      nonce: opts.nonce,
      code_challenge: generators.codeChallenge(opts.codeVerifier),
      code_challenge_method: "S256",
      // Keycloak-specific — skips its own Identity Provider picker and
      // jumps straight to this tenant's upstream IdP, since the tenant is
      // already known before this redirect happens (SsoController resolved
      // it from workspaceId). Requires the Identity Provider Redirector
      // authenticator to be present in the realm's browser flow — a
      // one-time Keycloak-side setup step, not something this code can
      // verify or default; see infra/keycloak/README.md.
      kc_idp_hint: opts.idpAlias,
    });
  }

  /** Exchanges an authorization `code` for tokens, validates the ID token
   * against Keycloak's own JWKS + the `nonce` claim (both handled internally
   * by `openid-client`), and returns the claims this codebase actually
   * needs. Throws if the identity provider never asserted an email at all —
   * `SsoConfig.requireEmailVerified` (checked by the caller) is a separate,
   * stricter gate on top of this.
   *
   * `callbackParams` must be the FULL, unmodified query object Keycloak's
   * redirect arrived with — not a hand-picked `{code, state}` subset. Found
   * live during E2E verification: `openid-client` v5 enforces RFC 9207's
   * `iss` response-parameter check when the discovered issuer advertises
   * support for it, and Keycloak's own redirect includes `iss` alongside
   * `code`/`state`/`session_state` — dropping it here made every real
   * exchange fail with "iss missing from the response" despite the
   * authorization step itself succeeding. */
  async exchangeCode(opts: {
    redirectUri: string;
    callbackParams: Record<string, string>;
    state: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<BrokerClaims> {
    const client = await this.resolveClient();
    const tokenSet = await client.callback(opts.redirectUri, opts.callbackParams, {
      code_verifier: opts.codeVerifier,
      state: opts.state,
      nonce: opts.nonce,
    });
    const claims = tokenSet.claims();
    if (!claims.email) {
      throw new Error("Identity provider did not return an email claim");
    }
    return {
      email: claims.email,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" ? claims.name : undefined,
    };
  }
}
