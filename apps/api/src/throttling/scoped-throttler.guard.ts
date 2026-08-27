import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { ThrottlerModuleOptions, ThrottlerStorage } from "@nestjs/throttler";
// ⚠️ A VALUE import, deliberately not `import type`. A type-only import is
// erased at compile time, so `design:paramtypes` records `Function` instead
// of the real class and Nest cannot resolve it — this failed at boot with an
// opaque "dependencies: [..., [Function: Function], ...] at index 2" error.
// The two parameters above are fine as types because the parent class's own
// metadata already supplies their injection tokens.
import { Reflector } from "@nestjs/core";
import { TenantContextService } from "../tenancy/tenant-context.service";

/**
 * Go-Live, Phase 04 — the global rate-limit guard.
 *
 * Differs from the stock `ThrottlerGuard` in exactly one way: **an
 * authenticated request is counted against the user, not the IP.**
 *
 * That distinction is load-bearing, not cosmetic. Keying everything by IP
 * would collectively throttle every employee behind one office NAT or VPN —
 * a whole company sharing a 300/min budget — while doing nothing to stop a
 * single compromised account scripted from many addresses. Keying by user
 * where we know who the user is fixes both directions.
 *
 * Unauthenticated requests still key by IP, because there is nothing else to
 * key on; that is exactly the bucket the tight `strict` limit exists for.
 *
 * `AuthContextMiddleware` runs `next()` inside the AsyncLocalStorage scope,
 * so the context is populated by the time guards execute — verified against
 * that middleware rather than assumed. It is *soft*: an absent or invalid
 * token simply leaves no context, which correctly falls through to IP.
 */
@Injectable()
export class ScopedThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const ctx = this.tenantContext.get();
    if (ctx) return `user:${ctx.authUserId}`;

    // `req.ip` is only the real client address once Express is told to trust
    // the platform's proxy — see `trust proxy` in main.ts. Without that, every
    // request behind a load balancer shares one address and a per-IP limit
    // would throttle the entire internet to a handful of requests a minute.
    const ip = (req.ip as string | undefined) ?? (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ?? "unknown";
    return `ip:${ip}`;
  }
}
