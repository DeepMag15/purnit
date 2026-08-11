import { z } from "zod";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  RadialBarChart,
  RadialBar,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";
import { CHART_SERIES_COLORS } from "./chart-colors";

export const ChartSchema = z.object({
  title: z.string().optional(),
  // stacked-bar/scatter/radial added Phase C (Visual & Widget-Type Depth) —
  // additive to the enum, no version bump, every existing call site's
  // behavior is unchanged (same precedent as bar/line/area's own earlier
  // addition to an originally donut-only enum).
  type: z.enum(["donut", "bar", "stacked-bar", "line", "area", "scatter", "radial"]).default("donut"),
  nameKey: z.string().default("status"),
  valueKey: z.string().default("count"),
});
type Props = z.infer<typeof ChartSchema>;

// Not part of ChartSchema — plain React values, same treatment
// CommonRenderProps.renderChild already gets.
interface ExtraProps {
  // Wires per-slice/per-bar click-to-drill-down for the Analytics module;
  // every existing static blueprint call site passes nothing and is unaffected.
  onSegmentClick?: (dimensionValue: string) => void;
  // Drives "stacked-bar": one <Bar stackId="a"> per key, colored by index.
  // Absent, stacked-bar falls back to a single series via valueKey (same as
  // "bar" today).
  seriesKeys?: string[];
  // Drive "scatter" — two numeric dimensions per row, a different shape
  // than nameKey/valueKey's "one category, one magnitude" convention.
  xKey?: string;
  yKey?: string;
}

const COLORS = CHART_SERIES_COLORS;

interface Row {
  [key: string]: unknown;
}

const tooltipStyle = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };
const axisStyle = { fontSize: 12, fill: "var(--color-text-muted)" };

// Donut (default) is the original single-visualization primitive; bar/line/
// area were added for Analytics (Core Workspace Modules, Phase 4) — a single
// consistent hue (COLORS[0]) for these three, not the cycling categorical
// palette, since a magnitude-comparison-across-categories or trend-over-time
// job is an identity-of-one situation, not a multi-series one.
export function Chart({ title, type, nameKey, valueKey, bind, onSegmentClick, seriesKeys, xKey = "x", yKey = "y" }: Props & CommonRenderProps & ExtraProps) {
  const { data, loading, error } = useDataBinding(bind);

  const rows = Array.isArray(data) ? (data as Row[]) : [];
  // "scatter" has no single magnitude field to sum (two independent numeric
  // dimensions, either of which can legitimately be 0) — row presence is the
  // right empty-check there; every other type keeps the existing sum-based
  // check (a row with a zero valueKey, e.g. a status with 0 count, should
  // still count toward "there is data").
  const total = type === "scatter" ? rows.length : rows.reduce((sum, r) => sum + (Number(r[valueKey]) || 0), 0);

  // Recharts' own onClick payload types (BarRectangleItem/PieSectorDataItem)
  // don't structurally match our generic Row — both actually carry the
  // original datum's fields at runtime, so a loose extraction here is safe;
  // same "registry entries are necessarily heterogeneous" precedent for an
  // explicit any as registry.ts's RegistryEntry.Component already sets.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts click payload shape, see comment above
  const handleSegmentClick = onSegmentClick ? (payload: any) => onSegmentClick(String(payload?.[nameKey] ?? payload?.payload?.[nameKey])) : undefined;

  return (
    <Card className="transition-shadow duration-[var(--duration-fast)] hover:shadow-md">
      <CardHeader title={title} />
      <CardBody>
        {loading && <Skeleton className="h-52 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load chart data: {error}</Alert>}
        {!loading && !error && (total === 0 ? (
          <EmptyStateView message="No data yet." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            {type === "bar" ? (
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey={nameKey} tick={axisStyle} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar
                  dataKey={valueKey}
                  fill={COLORS[0]}
                  radius={[4, 4, 0, 0]}
                  onClick={handleSegmentClick}
                  cursor={onSegmentClick ? "pointer" : undefined}
                />
              </BarChart>
            ) : type === "stacked-bar" ? (
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey={nameKey} tick={axisStyle} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {(seriesKeys ?? [valueKey]).map((key, i) => (
                  <Bar key={key} dataKey={key} stackId="a" fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            ) : type === "scatter" ? (
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey={xKey} type="number" tick={axisStyle} name={xKey} />
                <YAxis dataKey={yKey} type="number" tick={axisStyle} name={yKey} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={rows} fill={COLORS[0]} />
              </ScatterChart>
            ) : type === "radial" ? (
              <RadialBarChart data={rows} innerRadius="20%" outerRadius="90%">
                <RadialBar dataKey={valueKey} background>
                  {rows.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </RadialBar>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </RadialBarChart>
            ) : type === "line" ? (
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey={nameKey} tick={axisStyle} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey={valueKey} stroke={COLORS[0]} strokeWidth={2} dot={false} />
              </LineChart>
            ) : type === "area" ? (
              <AreaChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey={nameKey} tick={axisStyle} />
                <YAxis tick={axisStyle} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey={valueKey} stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.15} />
              </AreaChart>
            ) : (
              <PieChart>
                <Pie
                  data={rows}
                  dataKey={valueKey}
                  nameKey={nameKey}
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={2}
                  strokeWidth={0}
                  onClick={handleSegmentClick}
                  cursor={onSegmentClick ? "pointer" : undefined}
                >
                  {rows.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            )}
          </ResponsiveContainer>
        ))}
      </CardBody>
    </Card>
  );
}
