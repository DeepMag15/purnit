import { HealthController } from "./health.controller";
import type { TenantPrismaService } from "./tenancy/tenant-prisma.service";
import type { Response } from "express";

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: any };
}

function controllerWith(queryRaw: jest.Mock) {
  return new HealthController({ root: { $queryRaw: queryRaw } } as unknown as TenantPrismaService);
}

describe("HealthController", () => {
  it("reports healthy only after a real database round-trip", async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ "?column?": 1 }]);
    const res = fakeRes();
    await controllerWith(queryRaw).check(res);

    expect(queryRaw).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", database: "up" });
  });

  it("returns 503 when the database is unreachable", async () => {
    // The whole point of Phase 04's change. The previous static
    // `{ status: "ok" }` reported healthy for a process that had booted but
    // could not reach its database — so a deploy with a broken DATABASE_URL
    // would pass the host's health check and take live traffic.
    const res = fakeRes();
    await controllerWith(jest.fn().mockRejectedValue(new Error("connection refused"))).check(res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ status: "error", database: "down" });
  });

  it("signals failure through the status code, not just the body", async () => {
    // Render's probe and the uptime monitor read the status code. Returning
    // 200 with `{ status: "error" }` would defeat the entire mechanism.
    const res = fakeRes();
    await controllerWith(jest.fn().mockRejectedValue(new Error("down"))).check(res);
    expect(res.statusCode).not.toBe(200);
  });

  it("never leaks the underlying error to an unauthenticated caller", async () => {
    // This endpoint is public and unthrottled; a database error string can
    // carry a host, port, or role name.
    const res = fakeRes();
    await controllerWith(jest.fn().mockRejectedValue(new Error("FATAL: password authentication failed for user app_runtime"))).check(res);
    expect(JSON.stringify(res.body)).not.toMatch(/password|app_runtime|FATAL/i);
  });

  it("reports how long the check took, so a slow database is visible before it fails", async () => {
    const res = fakeRes();
    await controllerWith(jest.fn().mockResolvedValue([])).check(res);
    expect(typeof res.body.latencyMs).toBe("number");
  });
});
