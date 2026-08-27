import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { TenantContextService } from "../tenancy/tenant-context.service";

/**
 * Go-Live, Phase 04 — structured request logging.
 *
 * Emits one JSON line per request with the fields that actually make a
 * production log searchable: a request id, which tenant it belonged to, the
 * route, the status, and how long it took. Render and Railway both ingest
 * stdout, so this needs no separate logging platform.
 *
 * **What is deliberately NOT logged: request bodies, query strings, headers.**
 * Those are exactly where credentials, tokens and personal data live, and a
 * log line is the easiest place in a system to leak a secret without noticing.
 * The route pattern and status are enough to trace a request; if a body is
 * ever genuinely needed to debug something, it belongs in a temporary,
 * deliberate, redacted addition — not in the always-on path.
 *
 * `tenantId` is included because it is the single most useful filter when a
 * customer reports a problem, and it is an opaque identifier rather than
 * personal data. `authUserId` is included for the same reason.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("Request");

  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    // Honour an upstream id when the platform supplies one, so a request can
    // be followed across the proxy boundary rather than getting a fresh id
    // at every hop.
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
    res.setHeader("x-request-id", requestId);

    const startedAt = process.hrtime.bigint();

    const emit = (outcome: "ok" | "error", statusOverride?: number) => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      // Read at completion, not at entry: AuthContextMiddleware populates the
      // context for the whole downstream pipeline, and reading it here means
      // the line carries the tenant even for a request that resolved it late.
      const ctx = this.tenantContext.get();
      const line = {
        requestId,
        method: req.method,
        // The matched route pattern, not the raw URL — `/workspace/pages/:id`
        // rather than a path containing a real identifier. Keeps logs
        // aggregatable and avoids putting ids in log storage.
        route: (req.route as { path?: string } | undefined)?.path ?? req.baseUrl ?? "unknown",
        status: statusOverride ?? res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        tenantId: ctx?.tenantId ?? null,
        userId: ctx?.authUserId ?? null,
        outcome,
      };
      // One line, one JSON object — the format log aggregators parse without
      // configuration.
      this.logger.log(JSON.stringify(line));
    };

    return next.handle().pipe(
      tap({
        next: () => emit("ok"),
        // A thrown HttpException hasn't set the response status yet at this
        // point, so take it from the error when it carries one.
        error: (err: unknown) => {
          const status =
            typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
              ? (err as { status: number }).status
              : 500;
          emit("error", status);
        },
      }),
    );
  }
}
