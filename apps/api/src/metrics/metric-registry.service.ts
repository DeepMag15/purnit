import { Injectable } from "@nestjs/common";
import type { DataSourceContext } from "../data-sources/data-source-registry.service";
import type { PrismaTx } from "../tenancy/tenant-prisma.service";

// Finance Domain, Phase C — "currency" added. Value is always in minor
// currency units (cents), same convention every money field in this
// codebase already uses (see invoice.prisma's own doc comment) — the
// frontend divides by 100 and formats via Intl.NumberFormat, never the
// backend (same "compute, don't pre-format" discipline every other metric
// already follows for count/percent).
export type MetricFormat = "count" | "percent" | "duration" | "currency";

/** Analytics-scoped filter values, threaded from `analytics.dashboard`'s
 * params through to each metric's `computeLive`. A metric applies whichever
 * of these are meaningful to it and ignores the rest — there's no separate
 * declared-capability list to keep in sync. MUST always be layered as an
 * additional AND constraint on top of the metric's own scope-derived
 * `where` (via its module's `*Where()` builder), never as a replacement for
 * it — a filter can only narrow what a viewer's real permissions already
 * grant, never widen it. */
export interface AnalyticsFilters {
  from?: Date;
  to?: Date;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  employeeId?: string;
}

/** One pre-aggregated row the snapshot processor writes for one metric, one
 * tenant, one day. `departmentId: null` = tenant-wide. Phase A's
 * `computeDaily` implementations always return a single `{departmentId:
 * null, value}` row — the column exists now so a future per-department
 * rollup is an additive data change, not a schema migration. */
export interface SnapshotRow {
  departmentId: string | null;
  value: number;
}

export interface ScalarMetricDefinition {
  kind: "scalar";
  /** "module.verb" — same namespacing convention as data source names
   * (projects.count, tasks.list). Doubles as the AnalyticsSnapshot row key. */
  key: string;
  /** Groups widgets into a dashboard section — reuses PERMISSION_CATALOG's
   * module vocabulary (Projects, Tasks, Attendance, Meetings, ...). */
  module: string;
  label: string;
  /** "resource:action" — presence-only gate, identical contract to
   * DataSourceDefinition.requiredPermission. Absent = every tenant member
   * sees this widget. */
  requiredPermission?: string;
  format: MetricFormat;
  unit?: string;
  /** Cheap current-state value, computed fresh on every request — same cost
   * class as today's projects.count/tasks.count bindings. MUST reuse the
   * owning module's own *Where() builder — never reimplement scope filtering.
   * `filters` is optional and additive — a metric that ignores it keeps
   * behaving exactly as before. */
  computeLive: (ctx: DataSourceContext, tx: PrismaTx, filters?: AnalyticsFilters) => Promise<number>;
  /** Present = this metric also has pre-aggregated daily history, driving a
   * KpiCard's real trend sparkline. Called ONLY by
   * AnalyticsSnapshotProcessorService on its poll tick — never from the
   * request path. */
  snapshot?: {
    computeDaily: (tenantId: string, tx: PrismaTx) => Promise<SnapshotRow[]>;
  };
  /** Optional entity-level drill-down: an EXISTING list-shaped data source
   * name + static params to fetch when a viewer clicks this widget. Reuses
   * the module's own already-scoped list source — zero new backend surface
   * per drillable metric. */
  drillDown?: { source: string; params?: Record<string, unknown> };
}

export interface BreakdownMetricDefinition {
  kind: "breakdown";
  key: string;
  module: string;
  label: string;
  requiredPermission?: string;
  /** Matches Chart's nameKey/valueKey props directly. */
  nameKey: string;
  valueKey: string;
  computeLive: (ctx: DataSourceContext, tx: PrismaTx, filters?: AnalyticsFilters) => Promise<Record<string, unknown>[]>;
}

/** Phase F — blends 2+ already-registered SCALAR metrics into one derived
 * scalar value. `ingredients` are resolved by key lazily, at request time
 * (via MetricRegistry.get() inside analytics.dashboard's resolve loop) —
 * deliberately NOT at registration time, so which module registers a
 * composite is never sensitive to NestJS's module-init ordering against its
 * ingredients' own owning modules. Has no `requiredPermission` of its own —
 * visibility is computed as the AND of every ingredient's own
 * `requiredPermission` (see `isCompositeVisible` in analytics.data-sources.ts)
 * — safe specifically because each ingredient's own computeLive is already
 * independently scope-safe; a composite can never show a viewer a blended
 * number that leaks a component they couldn't already see individually. */
export interface CompositeMetricDefinition {
  kind: "composite";
  key: string;
  /** Typically "Cross-Module" — a composite rarely belongs to one owning
   * module the way a scalar/breakdown metric does. */
  module: string;
  label: string;
  format: MetricFormat;
  unit?: string;
  ingredients: readonly string[];
  combine: (values: Record<string, number>) => number;
}

export type MetricDefinition = ScalarMetricDefinition | BreakdownMetricDefinition | CompositeMetricDefinition;

/** Same registry pattern as DataSourceRegistry/MutationRegistry — in-process,
 * name-keyed, populated at boot by each feature module's own registrar.
 * Pure in-process infrastructure: analytics.dashboard (the thing actually
 * called over HTTP) and AnalyticsSnapshotProcessorService both consume it,
 * the same relationship PermissionResolverService has to ConfigEngineService. */
@Injectable()
export class MetricRegistry {
  private readonly metrics = new Map<string, MetricDefinition>();

  register(def: MetricDefinition): void {
    if (this.metrics.has(def.key)) {
      throw new Error(`Metric "${def.key}" is already registered`);
    }
    this.metrics.set(def.key, def);
  }

  get(key: string): MetricDefinition | undefined {
    return this.metrics.get(key);
  }

  list(): MetricDefinition[] {
    return [...this.metrics.values()];
  }
}
