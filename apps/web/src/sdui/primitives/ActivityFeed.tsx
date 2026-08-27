import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Skeleton } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { EmptyStateView } from "./EmptyState";

export const ActivityFeedSchema = z.object({
  title: z.string().optional(),
  limit: z.number().int().positive().default(10),
});
type Props = z.infer<typeof ActivityFeedSchema>;

interface NotificationRow {
  id: string;
  title: string;
  body?: string | null;
  readAt: string | null;
  createdAt: string;
}

// Same small per-module duplicated helper AnnouncementsWorkspace.tsx/
// DocumentsPanel.tsx already each have their own copy of — no shared
// formatting utility exists in this codebase yet.
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** A "Core Widget (Always Available)" — thin presentational list over the
 * already-real, own-scoped `notifications.list` source (no
 * requiredPermission, confirmed in notifications.data-sources.ts). Bound
 * directly via the blueprint's own `bind: {source, params}` mechanism
 * (seed.ts), not through `analytics.dashboard`'s widget array — Notification
 * rows are per-user personal data, not a cross-tenant MetricRegistry
 * concept. */
export function ActivityFeed({ title, limit, bind }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const rows = (Array.isArray(data) ? (data as NotificationRow[]) : []).slice(0, limit);

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-1">
        {loading && <Skeleton className="h-40 w-full" />}
        {error && <Alert tone="danger">Couldn&apos;t load activity: {error}</Alert>}
        {!loading && !error && (rows.length === 0 ? (
          <EmptyStateView message="Nothing yet." />
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 text-sm">
              <div className="min-w-0">
                <div className={row.readAt ? "truncate text-text-muted" : "truncate font-medium text-text"}>{row.title}</div>
                {row.body && <div className="truncate text-xs text-text-muted">{row.body}</div>}
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs text-text-muted">{formatRelativeTime(row.createdAt)}</span>
            </div>
          ))
        ))}
      </CardBody>
    </Card>
  );
}
