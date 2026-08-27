"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRenderContext } from "../../sdui/render-context";
import { useDataSourceQuery, dataSourceQueryKey } from "../../sdui/use-data-binding";
import { PageHeader } from "../../ui/PageHeader";
import { Card, CardBody } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import { StatusDot } from "../../ui/StatusDot";
import { Icon } from "../../ui/Icon";
import { SkeletonRows } from "../../ui/Skeleton";
import { EmptyStateView } from "../../sdui/primitives/EmptyState";

interface DigestCategory {
  count: number;
  items: Array<{ id: string; label: string; when: string }>;
}

interface DigestData {
  overdueTasks: DigestCategory;
  dueSoonTasks: DigestCategory;
  pendingApprovals: DigestCategory;
  todayEvents: DigestCategory;
  weekEvents: DigestCategory;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
  data: unknown;
}

// Phase E (proactive digests) — labels for DigestData's own keys, matching
// digest-content.ts's category order exactly.
const DIGEST_CATEGORY_LABELS: Record<keyof DigestData, string> = {
  overdueTasks: "Overdue tasks",
  dueSoonTasks: "Due soon",
  pendingApprovals: "Leave requests awaiting your approval",
  todayEvents: "Today",
  weekEvents: "Later this week",
};

// The 16 real `type` values this codebase's `tx.notification.create` call
// sites actually produce (confirmed via grep, not guessed) — a filter
// dropdown over real values, not a speculative enum.
const TYPE_LABELS: Record<string, string> = {
  "task.assigned": "Task assigned",
  "task.status_changed": "Task status changed",
  "task.reminder": "Task reminder",
  "announcement.posted": "Announcement posted",
  "message.mention": "Mentioned in a message",
  "comment.mention": "Mentioned in a comment",
  "delegation.granted": "Permission delegated to you",
  "delegation.revoked": "Delegated permission revoked",
  "attendance.corrected": "Attendance corrected",
  "calendarEvent.posted": "Calendar event posted",
  "calendarEvent.reminder": "Calendar event reminder",
  "meeting.invited": "Meeting invitation",
  "meeting.reminder": "Meeting reminder",
  "leave.submitted": "Leave request submitted",
  "leave.approved": "Leave request approved",
  "leave.rejected": "Leave request rejected",
  "digest.daily": "Daily digest",
};

const PAGE_SIZE = 20;

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

/**
 * Notifications — module 3 of 6. The bell dropdown (`NotificationBell.tsx`)
 * only ever fetches `notifications.list({})`, the first 20 rows, with no way
 * to see older ones or filter by type; this is that "see everything" page,
 * reached via the bell's own "See all" link and a new dedicated nav entry.
 * `notifications.list` is the first genuinely server-paginated data source
 * in the codebase (see notifications.data-sources.ts) — `page`/`type`/
 * `unreadOnly` are all real params, not client-side slicing over an
 * already-fetched array like `Table3`/`usePagination` do everywhere else.
 */
export function NotificationsPage() {
  const { user, tenant, callMutation } = useRenderContext();
  const queryClient = useQueryClient();

  const [type, setType] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = { ...(type ? { type } : {}), ...(unreadOnly ? { unreadOnly: true } : {}), page };
  const { data, isPending } = useDataSourceQuery<NotificationRow[]>("notifications.list", params);
  const rows = Array.isArray(data) ? data : [];
  const hasNextPage = rows.length === PAGE_SIZE;

  function updateFilter(next: Partial<{ type: string; unreadOnly: boolean }>) {
    if (next.type !== undefined) setType(next.type);
    if (next.unreadOnly !== undefined) setUnreadOnly(next.unreadOnly);
    setPage(0);
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  // Marking read/all-read can change what belongs on *any* page or filter
  // combination this session has already cached (a row disappearing from an
  // `unreadOnly` page, an unread count changing) — `dataSourceQueryKey`'s
  // first two elements are always `["dataSource", source]`, so this
  // partial-matches every params/page variant of this source, the same
  // default (non-`exact`) invalidation behavior TanStack Query documents.
  function invalidateAllNotificationQueries() {
    queryClient.invalidateQueries({ queryKey: ["dataSource", "notifications.list"] });
    queryClient.invalidateQueries({ queryKey: dataSourceQueryKey("notifications.unreadCount", {}, tenant.id, user.id) });
  }

  async function handleMarkRead(row: NotificationRow) {
    if (row.readAt) return;
    await callMutation("notification.markRead", { id: row.id });
    invalidateAllNotificationQueries();
  }

  async function handleMarkAllRead() {
    await callMutation("notification.markAllRead", {});
    invalidateAllNotificationQueries();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Notifications"
        description="Everything sent to you, in one place."
        actions={
          <Button variant="secondary" size="sm" onClick={handleMarkAllRead}>
            <Icon name="check" size={14} />
            Mark all read
          </Button>
        }
        filters={
          <>
            <Select aria-label="Filter by type" value={type} onChange={(e) => updateFilter({ type: e.target.value })} className="w-56">
              <option value="">All types</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Switch label="Unread only" checked={unreadOnly} onChange={(e) => updateFilter({ unreadOnly: e.target.checked })} />
          </>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-1 p-2">
          {isPending && <SkeletonRows rows={4} />}
          {!isPending && rows.length === 0 && <EmptyStateView message="No notifications here." />}
          {!isPending &&
            rows.map((row) => {
              const isDigest = row.type === "digest.daily";
              return (
                <div key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      handleMarkRead(row);
                      if (isDigest) toggleExpanded(row.id);
                    }}
                    className={
                      row.readAt
                        ? "flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left cursor-default"
                        : "flex w-full items-start justify-between gap-3 rounded-md bg-accent/5 px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] hover:bg-accent/10"
                    }
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {isDigest && <Icon name={expandedId === row.id ? "expand_less" : "expand_more"} size={16} className="mt-0.5 shrink-0 text-text-muted" />}
                      {!isDigest && !row.readAt && <StatusDot tone="queued" className="mt-1.5 shrink-0" />}
                      <div className="min-w-0">
                        <div className={row.readAt ? "text-sm text-text-muted" : "text-sm font-semibold text-text"}>{row.title}</div>
                        {row.body && <div className="mt-0.5 text-xs text-text-muted">{row.body}</div>}
                        <div className="mt-0.5 text-[11px] text-text-muted">{TYPE_LABELS[row.type] ?? row.type}</div>
                      </div>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs text-text-muted">{formatRelativeTime(row.createdAt)}</span>
                  </button>
                  {isDigest && expandedId === row.id && <DigestBreakdown data={row.data} />}
                </div>
              );
            })}
        </CardBody>
      </Card>

      {(page > 0 || hasNextPage) && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <Icon name="chevron_left" size={14} />
            Newer
          </Button>
          <span className="text-xs text-text-muted">Page {page + 1}</span>
          <Button variant="secondary" size="sm" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>
            Older
            <Icon name="chevron_right" size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

// Phase E (proactive digests) — the digest notification's own per-category
// breakdown, reusing AuditLogsPage's own already-established "click a row to
// expand structured data below it" interaction rather than inventing a new
// pattern. `NotificationBell.tsx`'s compact dropdown never renders this —
// its existing title/body rendering already reads correctly for a digest's
// one-line summary body; this richer view is reserved for the full page.
function DigestBreakdown({ data }: { data: unknown }) {
  const digest = data as Partial<DigestData> | null;
  if (!digest) return null;
  const categoryKeys = Object.keys(DIGEST_CATEGORY_LABELS) as Array<keyof DigestData>;
  const nonEmpty = categoryKeys.filter((key) => (digest[key]?.count ?? 0) > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 border-t border-border bg-surface-sunk px-3 py-2.5 sm:grid-cols-2">
      {nonEmpty.map((key) => {
        const category = digest[key]!;
        return (
          <div key={key}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {DIGEST_CATEGORY_LABELS[key]} ({category.count})
            </div>
            <ul className="flex flex-col gap-0.5 text-xs text-text">
              {category.items.map((item) => (
                <li key={item.id} className="truncate">
                  {item.label} <span className="text-text-muted">— {new Date(item.when).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
