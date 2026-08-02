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

import { Table, TableSchema } from "./Table";
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
  registerPrimitive("List", 1, ListSchema, List);

  registerPrimitive("SearchBar", 1, SearchBarSchema, SearchBar);
  registerPrimitive("FilterBar", 1, FilterBarSchema, FilterBar);

  registerPrimitive("Button", 1, ButtonSchema, Button);
  registerPrimitive("ActionMenu", 1, ActionMenuSchema, ActionMenu);
  registerPrimitive("Link", 1, LinkSchema, Link);
  registerPrimitive("QuickActions", 1, QuickActionsSchema, QuickActions);
}
