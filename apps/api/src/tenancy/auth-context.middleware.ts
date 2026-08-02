import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { JwtVerifierService } from "./jwt-verifier.service";
import { TenantContextService } from "./tenant-context.service";

/**
 * Soft context population: verifies the bearer token if present and, on success,
 * scopes the rest of the request pipeline inside TenantContextService's
 * AsyncLocalStorage. Does NOT enforce that a token is present or valid — that's
 * JwtAuthGuard's job on routes that opt in. Public routes (health, signup) never
 * look at the context at all.
 */
@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtVerifier: JwtVerifierService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    if (!token) {
      next();
      return;
    }

    try {
      const payload = await this.jwtVerifier.verify(token);
      if (!payload.tenant_id) {
        // Valid Supabase session, but our custom claims hook hasn't stamped
        // tenant_id (e.g. hook not yet enabled, or user has no tenant row).
        next();
        return;
      }
      this.tenantContext.run(
        {
          tenantId: payload.tenant_id,
          authUserId: payload.sub,
          permissionsHash: payload.permissions_hash ?? "",
        },
        next,
      );
    } catch {
      // Invalid/expired token: proceed without context; JwtAuthGuard rejects
      // protected routes that require it.
      next();
    }
  }
}
