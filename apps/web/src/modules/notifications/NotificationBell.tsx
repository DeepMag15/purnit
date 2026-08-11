import { useCallback, useEffect, useRef, useState } from "react";
import { useRenderContext } from "../../sdui/render-context";
import { cn } from "../../ui/utils";
import { Icon } from "../../ui/Icon";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 15_000;

/**
 * Global chrome, not a blueprint page node — same precedent as the sidebar
 * nav in `workspace/layout.tsx`: it reads live data (via `callDataSource`)
 * but its *placement* is fixed frontend code, not something a blueprint
 * page tree describes. A notification center needs to persist across every
 * page, and Phase 1 has no mechanism for a node to live outside a specific
 * page's tree (see CONTEXT.md §16's note on the sidebar for the same
 * reasoning).
 */
export function NotificationBell() {
  const { callDataSource, callMutation } = useRenderContext();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(() => {
    callDataSource("notifications.unreadCount", {})
      .then((count) => setUnreadCount(typeof count === "number" ? count : 0))
      .catch(() => {
        // Polling failure (e.g. a transient network blip) just skips this
        // tick — not worth surfacing an error state for a background poll.
      });
  }, [callDataSource]);

  useEffect(() => {
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshUnreadCount]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleOpen() {
    setOpen((wasOpen) => {
      const willOpen = !wasOpen;
      if (willOpen) {
        setLoading(true);
        callDataSource("notifications.list", {})
          .then((data) => setRows(Array.isArray(data) ? (data as NotificationRow[]) : []))
          .finally(() => setLoading(false));
      }
      return willOpen;
    });
  }

  async function handleMarkRead(id: string) {
    await callMutation("notification.markRead", { id });
    setRows((current) => current.map((r) => (r.id === id ? { ...r, readAt: new Date().toISOString() } : r)));
    refreshUnreadCount();
  }

  async function handleMarkAllRead() {
    await callMutation("notification.markAllRead", {});
    setRows((current) => current.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })));
    refreshUnreadCount();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-text"
      >
        <Icon name="notifications" size={17} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[15px] text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-80 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="text-sm font-semibold text-text">Notifications</span>
            {rows.some((r) => !r.readAt) && (
              <button type="button" onClick={handleMarkAllRead} className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                <Icon name="check" size={12} />
                Mark all read
              </button>
            )}
          </div>

          {loading && <div className="p-3.5 text-sm text-text-muted">Loading…</div>}
          {!loading && rows.length === 0 && <div className="p-3.5 text-sm text-text-muted">No notifications yet.</div>}
          {!loading &&
            rows.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => !n.readAt && handleMarkRead(n.id)}
                className={cn(
                  "block w-full border-b border-border px-3.5 py-2.5 text-left transition-colors duration-[var(--duration-fast)] last:border-b-0",
                  n.readAt ? "cursor-default" : "cursor-pointer bg-accent/5 hover:bg-accent/10",
                )}
              >
                <div className={cn("text-sm text-text", !n.readAt && "font-semibold")}>{n.title}</div>
                {n.body && <div className="mt-0.5 text-xs text-text-muted">{n.body}</div>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
