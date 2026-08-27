import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface SsoStatePayload {
  tenantId: string;
  codeVerifier: string;
  oidcNonce: string;
  csrfNonce: string;
  exp: number; // epoch seconds
}

// A redirect round trip through Keycloak + an upstream IdP is seconds, not
// minutes — kept short since this token doubles as the flow's only session
// (this codebase has no server-side session store, see tenant-prisma.service.ts).
const STATE_TTL_SECONDS = 300;

/**
 * Enterprise SSO's `state` token is a signed, stateless carrier for the
 * whole in-flight login (tenant, PKCE verifier, both nonces) — the same
 * "no server-side session store, sign what you need into a token" shape
 * this codebase already uses for JWTs everywhere else, just HMAC'd instead
 * of a full JWT since nothing outside this service ever needs to read it.
 * `csrfNonce` is deliberately separate from `oidcNonce`: the OIDC nonce
 * defends the ID token against replay, this one binds the callback to the
 * *browser* that started the flow (checked against a same-site cookie in
 * SsoController) — signing alone only proves the token wasn't forged, not
 * that this request came from the browser that initiated it.
 */
@Injectable()
export class SsoStateService {
  private secret(): string {
    const secret = process.env.SSO_STATE_SECRET;
    if (!secret) {
      throw new Error("Enterprise SSO is not configured — set SSO_STATE_SECRET to enable it.");
    }
    return secret;
  }

  sign(payload: Omit<SsoStatePayload, "exp">): string {
    const full: SsoStatePayload = { ...payload, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS };
    const body = Buffer.from(JSON.stringify(full)).toString("base64url");
    const signature = createHmac("sha256", this.secret()).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  verify(token: string): SsoStatePayload {
    const [body, signature] = token.split(".");
    if (!body || !signature) {
      throw new Error("Malformed SSO state");
    }

    const expected = createHmac("sha256", this.secret()).update(body).digest("base64url");
    const signatureBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    // timingSafeEqual throws on mismatched lengths rather than returning
    // false — the length check below is a required guard, not a shortcut.
    if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
      throw new Error("Invalid SSO state signature");
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SsoStatePayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("SSO state has expired");
    }
    return payload;
  }

  generateCsrfNonce(): string {
    return randomBytes(18).toString("base64url");
  }
}
