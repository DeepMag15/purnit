"use client";

import { useDataSourceQuery } from "../../../sdui/use-data-binding";
import { Card, CardHeader, CardBody } from "../../../ui";
import { SkeletonRows } from "../../../ui/Skeleton";
import { Alert } from "../../../ui/Alert";
import { EmptyStateView } from "../../../sdui/primitives/EmptyState";

interface Announcement {
  id: string;
  title: string;
  authorName: string | null;
  createdAt: string;
}

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

export function AnnouncementsWidget() {
  const { data, isPending, error } = useDataSourceQuery<Announcement[]>("announcements.list");
  const items = (Array.isArray(data) ? data : []).slice(0, 3);

  return (
    <Card>
      <CardHeader title="Announcements" />
      <CardBody className="flex flex-col gap-1">
        {isPending && <SkeletonRows rows={2} />}
        {!isPending && error && <Alert tone="danger">Couldn&apos;t load announcements.</Alert>}
        {!isPending && !error && items.length === 0 && <EmptyStateView icon="campaign" message="No recent announcements." />}
        {!isPending &&
          !error &&
          items.map((a) => (
            <div
              key={a.id}
              className="flex flex-col gap-0.5 rounded-md border-t border-border px-1.5 py-2.5 transition-colors duration-[var(--duration-fast)] first:border-t-0 hover:bg-surface-hover"
            >
              <span className="truncate text-sm text-text">{a.title}</span>
              <span className="text-xs text-text-muted">
                {a.authorName ?? "Unknown"} · {formatRelativeTime(a.createdAt)}
              </span>
            </div>
          ))}
      </CardBody>
    </Card>
  );
}
