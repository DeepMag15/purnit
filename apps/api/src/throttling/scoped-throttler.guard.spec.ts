import { ScopedThrottlerGuard } from "./scoped-throttler.guard";
import { TenantContextService } from "../tenancy/tenant-context.service";
import type { ThrottlerModuleOptions, ThrottlerStorage } from "@nestjs/throttler";
import type { Reflector } from "@nestjs/core";
import { THROTTLERS, DEFAULT_LIMIT, STRICT_LIMIT, SSO_LIMIT } from "./throttle.config";

/** `getTracker` is protected; this exposes it for testing without loosening
 * the class's own API. */
class TestableGuard extends ScopedThrottlerGuard {
  track(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}

function guardWith(tenantContext: TenantContextService) {
  return new TestableGuard(
    THROTTLERS as unknown as ThrottlerModuleOptions,
    {} as ThrottlerStorage,
    {} as Reflector,
    tenantContext,
  );
}

describe("ScopedThrottlerGuard", () => {
  it("counts an authenticated request against the user, not the IP", async () => {
    // Keying everything by IP would collectively throttle every employee
    // behind one office NAT while doing nothing about a compromised account
    // scripted from many addresses.
    const ctx = new TenantContextService();
    const tracker = await ctx.run({ tenantId: "t1", authUserId: "auth-user-1", permissionsHash: "h" }, () =>
      guardWith(ctx).track({ ip: "203.0.113.9" }),
    );
    expect(tracker).toBe("user:auth-user-1");
  });

  it("gives two users behind one IP separate budgets", async () => {
    const ctx = new TenantContextService();
    const a = await ctx.run({ tenantId: "t1", authUserId: "user-a", permissionsHash: "h" }, () =>
      guardWith(ctx).track({ ip: "203.0.113.9" }),
    );
    const b = await ctx.run({ tenantId: "t1", authUserId: "user-b", permissionsHash: "h" }, () =>
      guardWith(ctx).track({ ip: "203.0.113.9" }),
    );
    expect(a).not.toBe(b);
  });

  it("falls back to the IP when there is no auth context", async () => {
    // Unauthenticated traffic has nothing else to key on — this is exactly
    // the bucket the tight `strict` limit protects.
    const ctx = new TenantContextService();
    expect(await guardWith(ctx).track({ ip: "203.0.113.9" })).toBe("ip:203.0.113.9");
  });

  it("falls back to the socket address when req.ip is absent", async () => {
    const ctx = new TenantContextService();
    expect(await guardWith(ctx).track({ socket: { remoteAddress: "198.51.100.4" } })).toBe("ip:198.51.100.4");
  });

  it("never returns an empty tracker, which would merge every caller into one bucket", async () => {
    const ctx = new TenantContextService();
    const tracker = await guardWith(ctx).track({});
    expect(tracker).toBe("ip:unknown");
    expect(tracker.length).toBeGreaterThan(0);
  });
});

describe("throttle config", () => {
  it("registers exactly one global throttler", () => {
    // Several named throttlers would ALL apply to every route, silently
    // capping the whole API at the tightest limit. Per-route overrides are
    // the correct mechanism instead.
    expect(THROTTLERS).toHaveLength(1);
  });

  it("keeps the unauthenticated limit far tighter than the authenticated one", () => {
    expect(STRICT_LIMIT).toBeLessThan(DEFAULT_LIMIT);
    expect(SSO_LIMIT).toBeLessThan(DEFAULT_LIMIT);
  });

  it("leaves real UI flows an order of magnitude of headroom", () => {
    // A page can fire a dozen parallel data-source calls; the limit must not
    // be reachable by legitimate use.
    expect(DEFAULT_LIMIT).toBeGreaterThanOrEqual(300);
  });
});
