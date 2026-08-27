import { Throttle } from "@nestjs/throttler";
import type { ThrottlerOptions } from "@nestjs/throttler";

/**
 * Go-Live, Phase 04 — API rate limits.
 *
 * Before this, rate limiting existed on exactly three SSO routes and nowhere
 * else: login, signup and every data source were unlimited.
 *
 * **One global throttler, overridden per route** — deliberately not several
 * named throttlers. In `@nestjs/throttler`, every named throttler applies to
 * every route unless explicitly skipped, so declaring `strict` alongside
 * `default` would silently cap the *entire* API at the strict limit. Named
 * buckets only make sense when a route should be subject to several
 * simultaneous limits, which is not what we want here.
 */

const MINUTE = 60_000;

/** Authenticated traffic: data sources, mutations, workspace bootstrap.
 * Generous enough that no real UI flow reaches it — a page firing a dozen
 * parallel data-source calls still has an order of magnitude of room — but
 * low enough to blunt a scripted or compromised client. */
export const DEFAULT_LIMIT = 300;

/** Unauthenticated credential-adjacent routes: signup, the login pre-flight
 * check, password reset. These are the credential-stuffing and enumeration
 * targets, and no legitimate person submits a login form ten times a minute. */
export const STRICT_LIMIT = 10;

/** The SSO broker round-trip — unchanged from the limit SsoModule already
 * applied on its own before rate limiting became global. */
export const SSO_LIMIT = 20;

export const THROTTLERS: ThrottlerOptions[] = [{ ttl: MINUTE, limit: DEFAULT_LIMIT }];

/** Tightens a route to the unauthenticated bucket. Applied to the public auth
 * endpoints, which are keyed per IP because there is no user yet. */
export const StrictThrottle = () => Throttle({ default: { ttl: MINUTE, limit: STRICT_LIMIT } });

/** The SSO controller's own limit. */
export const SsoThrottle = () => Throttle({ default: { ttl: MINUTE, limit: SSO_LIMIT } });
