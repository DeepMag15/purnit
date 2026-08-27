import { AnalyticsSnapshotProcessorService } from "./analytics-snapshot-processor.service";
import { MetricRegistry, type ScalarMetricDefinition } from "../../metrics/metric-registry.service";
import type { TenantPrismaService, PrismaTx } from "../../tenancy/tenant-prisma.service";

function snapshotMetric(key: string, value: number, departmentId: string | null = null): ScalarMetricDefinition {
  return {
    kind: "scalar",
    key,
    module: "Test",
    label: key,
    format: "count",
    computeLive: async () => value,
    snapshot: { computeDaily: async () => [{ departmentId, value }] },
  };
}

function noSnapshotMetric(key: string): ScalarMetricDefinition {
  return { kind: "scalar", key, module: "Test", label: key, format: "count", computeLive: async () => 0 };
}

describe("AnalyticsSnapshotProcessorService", () => {
  it("deletes-then-recreates only today's rows per snapshot-capable metric, sequentially inside one tenantPrisma.run() call", async () => {
    const registry = new MetricRegistry();
    registry.register(snapshotMetric("with.snapshot", 42));
    registry.register(noSnapshotMetric("without.snapshot"));

    const callOrder: string[] = [];
    const deleteMany = jest.fn().mockImplementation(() => {
      callOrder.push("deleteMany");
      return Promise.resolve();
    });
    const createMany = jest.fn().mockImplementation(() => {
      callOrder.push("createMany");
      return Promise.resolve();
    });
    const tx = { analyticsSnapshot: { deleteMany, createMany } } as unknown as PrismaTx;

    const tenantPrisma = {
      root: { tenant: { findMany: jest.fn().mockResolvedValue([{ id: "t1" }]) } },
      run: jest.fn().mockImplementation((_tenantId: string, fn: (tx: PrismaTx) => Promise<void>) => fn(tx)),
    } as unknown as TenantPrismaService;

    const service = new AnalyticsSnapshotProcessorService(tenantPrisma, registry);
    await service.tick();

    // Only the snapshot-capable metric is touched.
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany.mock.calls[0]![0].where).toMatchObject({ tenantId: "t1", metricKey: "with.snapshot" });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]![0].data).toEqual([
      expect.objectContaining({ tenantId: "t1", metricKey: "with.snapshot", departmentId: null, value: 42, granularity: "day" }),
    ]);
    // Sequential: delete completes before create starts for the same metric.
    expect(callOrder).toEqual(["deleteMany", "createMany"]);
  });

  it("processes each tenant returned by the per-tenant round robin", async () => {
    const registry = new MetricRegistry();
    registry.register(snapshotMetric("m", 1));
    const tx = { analyticsSnapshot: { deleteMany: jest.fn(), createMany: jest.fn() } } as unknown as PrismaTx;
    const runSpy = jest.fn().mockImplementation((_tenantId: string, fn: (tx: PrismaTx) => Promise<void>) => fn(tx));
    const tenantPrisma = {
      root: { tenant: { findMany: jest.fn().mockResolvedValue([{ id: "t1" }, { id: "t2" }]) } },
      run: runSpy,
    } as unknown as TenantPrismaService;

    const service = new AnalyticsSnapshotProcessorService(tenantPrisma, registry);
    await service.tick();

    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(runSpy.mock.calls.map((c) => c[0])).toEqual(["t1", "t2"]);
  });

  it("a failure recomputing one tenant doesn't stop the others", async () => {
    const registry = new MetricRegistry();
    registry.register(snapshotMetric("m", 1));
    const tenantPrisma = {
      root: { tenant: { findMany: jest.fn().mockResolvedValue([{ id: "bad" }, { id: "good" }]) } },
      run: jest.fn().mockImplementation((tenantId: string, fn: (tx: PrismaTx) => Promise<void>) => {
        if (tenantId === "bad") return Promise.reject(new Error("boom"));
        return fn({ analyticsSnapshot: { deleteMany: jest.fn(), createMany: jest.fn() } } as unknown as PrismaTx);
      }),
    } as unknown as TenantPrismaService;

    const service = new AnalyticsSnapshotProcessorService(tenantPrisma, registry);
    await expect(service.tick()).resolves.toBeUndefined();
    expect((tenantPrisma.run as jest.Mock).mock.calls.map((c) => c[0])).toEqual(["bad", "good"]);
  });
});
