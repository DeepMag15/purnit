import { Injectable } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface SupabaseJwtPayload extends JWTPayload {
  sub: string; // Supabase auth user id
  tenant_id?: string;
  permissions_hash?: string;
}

/**
 * Verifies Supabase-issued JWTs against the project's JWKS endpoint. This works
 * regardless of whether the project signs with an asymmetric algorithm (current
 * Supabase default for new projects) since we never assume a specific algorithm
 * or a shared HS256 secret — the JWKS endpoint is authoritative either way.
 */
@Injectable()
export class JwtVerifierService {
  private readonly jwks = createRemoteJWKSet(
    new URL("/auth/v1/.well-known/jwks.json", process.env.SUPABASE_URL),
  );

  async verify(token: string): Promise<SupabaseJwtPayload> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: process.env.JWT_ISSUER,
    });
    return payload as SupabaseJwtPayload;
  }
}
