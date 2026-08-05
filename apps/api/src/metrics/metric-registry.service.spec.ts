import { MetricRegistry, type ScalarMetricDefinition } from "./metric-registry.service";

function scalarMetric(key: string): ScalarMetricDefinition {
  return { kind: "scalar", key, module: "Test", label: key, format: "count", computeLive: async () => 0 };
}

describe("MetricRegistry", () => {
  it("registers and retrieves a metric by key", () => {
    const registry = new MetricRegistry();
    const metric = scalarMetric("test.one");
    registry.register(metric);
    expect(registry.get("test.one")).toBe(metric);
  });

  it("throws when registering the same key twice", () => {
    const registry = new MetricRegistry();
    registry.register(scalarMetric("test.one"));
    expect(() => registry.register(scalarMetric("test.one"))).toThrow('Metric "test.one" is already registered');
  });

  it("list() returns every registered metric", () => {
    const registry = new MetricRegistry();
    registry.register(scalarMetric("test.one"));
    registry.register(scalarMetric("test.two"));
    expect(registry.list().map((m) => m.key).sort()).toEqual(["test.one", "test.two"]);
  });

  it("get() returns undefined for an unknown key", () => {
    const registry = new MetricRegistry();
    expect(registry.get("ghost")).toBeUndefined();
  });
});
