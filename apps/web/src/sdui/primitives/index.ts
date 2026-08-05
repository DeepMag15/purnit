import dynamic from "next/dynamic";
import { registerPrimitive } from "../registry";

import { Page, PageSchema } from "./Page";
import { Section, SectionSchema } from "./Section";
import { Stack, StackSchema } from "./Stack";
import { Grid, GridSchema } from "./Grid";
import { Card, CardSchema } from "./Card";

import { Heading, HeadingSchema } from "./Heading";
import { Text, TextSchema } from "./Text";
import { KpiCard, KpiCardSchema } from "./KpiCard";
import { Badge, BadgeSchema } from "./Badge";
import { EmptyState, EmptyStateSchema } from "./EmptyState";
// Performance-audit fix (CONTEXT.md §47): `Chart` pulls in recharts, which
// used to be statically imported here — every page paid for it in the
// shared bundle whether or not a Chart node was ever rendered. `ChartSchema`
// (just a Zod shape, no recharts import) still needs to be static, since
// `registerPrimitive` validates props against it synchronously; only the
// component itself is lazy.
import { ChartSchema } from "./Chart";
const Chart = dynamic(() => import("./Chart").then((m) => m.Chart));

// Phase C (Visual & Widget-Type Depth) — Treemap/Funnel/TimelineChart all
// pull in recharts, same bundle-size reasoning as Chart above: schema
// (plain Zod, no recharts import) stays static since registerPrimitive
// validates props against it synchronously, only the component is lazy.
import { TreemapSchema } from "./Treemap";
const Treemap = dynamic(() => import("./Treemap").then((m) => m.Treemap));
import { FunnelSchema } from "./Funnel";
const Funnel = dynamic(() => import("./Funnel").then((m) => m.Funnel));
import { TimelineChartSchema } from "./TimelineChart";
const TimelineChart = dynamic(() => import("./TimelineChart").then((m) => m.TimelineChart));

// Hand-built (no recharts) — statically imported, same as Heatmap/List below.
import { Heatmap, HeatmapSchema } from "./Heatmap";
import { CalendarHeatmap, CalendarHeatmapSchema } from "./CalendarHeatmap";
import { ProgressGoal, ProgressGoalSchema } from "./ProgressGoal";
import { Leaderboard, LeaderboardSchema } from "./Leaderboard";
import { ActivityFeed, ActivityFeedSchema } from "./ActivityFeed";

import { Table, TableSchema, Table3, Table3Schema } from "./Table";
import { List, ListSchema } from "./List";

import { SearchBar, SearchBarSchema } from "./SearchBar";
import { FilterBar, FilterBarSchema } from "./FilterBar";

import { Button, ButtonSchema } from "./Button";
import { ActionMenu, ActionMenuSchema } from "./ActionMenu";
import { Link, LinkSchema } from "./Link";
import { QuickActions, QuickActionsSchema } from "./QuickActions";

let registered = false;

/** Registers the core primitive set (version 1 of each). Composite widgets
 * (ProjectBoard, TaskList, …) register themselves separately — see
 * modules/. Idempotent: safe to call more than once (React Strict Mode /
 * Next.js Fast Refresh can re-execute module init). */
export function registerCorePrimitives(): void {
  if (registered) return;
  registered = true;

  registerPrimitive("Page", 1, PageSchema, Page);
  registerPrimitive("Section", 1, SectionSchema, Section);
  registerPrimitive("Stack", 1, StackSchema, Stack);
  registerPrimitive("Grid", 1, GridSchema, Grid);
  registerPrimitive("Card", 1, CardSchema, Card);

  registerPrimitive("Heading", 1, HeadingSchema, Heading);
  registerPrimitive("Text", 1, TextSchema, Text);
  registerPrimitive("KpiCard", 1, KpiCardSchema, KpiCard);
  registerPrimitive("Badge", 1, BadgeSchema, Badge);
  registerPrimitive("EmptyState", 1, EmptyStateSchema, EmptyState);
  registerPrimitive("Chart", 1, ChartSchema, Chart);

  registerPrimitive("Table", 2, TableSchema, Table);
  registerPrimitive("Table", 3, Table3Schema, Table3);
  registerPrimitive("List", 1, ListSchema, List);

  // Phase C (Visual & Widget-Type Depth)
  registerPrimitive("Treemap", 1, TreemapSchema, Treemap);
  registerPrimitive("Funnel", 1, FunnelSchema, Funnel);
  registerPrimitive("Heatmap", 1, HeatmapSchema, Heatmap);
  registerPrimitive("CalendarHeatmap", 1, CalendarHeatmapSchema, CalendarHeatmap);
  registerPrimitive("TimelineChart", 1, TimelineChartSchema, TimelineChart);
  registerPrimitive("ProgressGoal", 1, ProgressGoalSchema, ProgressGoal);
  registerPrimitive("Leaderboard", 1, LeaderboardSchema, Leaderboard);
  registerPrimitive("ActivityFeed", 1, ActivityFeedSchema, ActivityFeed);

  registerPrimitive("SearchBar", 1, SearchBarSchema, SearchBar);
  registerPrimitive("FilterBar", 1, FilterBarSchema, FilterBar);

  registerPrimitive("Button", 1, ButtonSchema, Button);
  registerPrimitive("ActionMenu", 1, ActionMenuSchema, ActionMenu);
  registerPrimitive("Link", 1, LinkSchema, Link);
  registerPrimitive("QuickActions", 1, QuickActionsSchema, QuickActions);
}
