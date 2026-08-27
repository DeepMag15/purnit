import { Controller, Get, Logger, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { TenantPrismaService } from "./tenancy/tenant-prisma.service";

/**
 * Go-Live, Phase 04 — a health probe that actually probes something.
 *
 * This previously returned a static `{ status: "ok" }`, which is worse than
 * useless in production: it reports healthy for a process that has booted but
 * cannot reach its database, so a deploy with a broken `DATABASE_URL` would
 * pass the host's health check and take live traffic.
 *
 * Render's zero-downtime deploys and the external uptime monitor both key off
 * this endpoint, so it must answer the question that matters — "can this
 * instance actually serve a request?" — not "is the process alive?".
 *
 * `@SkipThrottle()` is deliberate and necessary: an uptime monitor polls this
 * on a fixed interval from one address, and the platform's own probe adds
 * more. Rate limiting it would eventually mark a perfectly healthy service as
 * down.
 */
@Controller("health")
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  async check(@Res() res: Response) {
    const startedAt = Date.now();
    try {
      // The cheapest possible round-trip that proves the pool is alive and
      // the credentials work. Runs against the unscoped root client — there
      // is no tenant context on an unauthenticated probe, and this
      // deliberately reads no tenant data.
      await this.tenantPrisma.root.$queryRaw`SELECT 1`;
      res.status(200).json({
        status: "ok",
        database: "up",
        latencyMs: Date.now() - startedAt,
        uptimeSeconds: Math.round(process.uptime()),
      });
    } catch (err) {
      // 503, not 200-with-a-flag: the host's health check reads the status
      // code, and returning 200 here would defeat the entire mechanism.
      this.logger.error(`Health check failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(503).json({
        status: "error",
        database: "down",
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}
