import { StatusDot, type StatusTone } from "./StatusDot";
import { Tooltip } from "./Tooltip";

const STATUS_TONE: Record<string, StatusTone> = {
  online: "done",
  away: "progress",
  busy: "danger",
  offline: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  away: "Away",
  busy: "Busy",
  offline: "Offline",
};

/**
 * Presence & Status (module 4 of 6) — a dumb presentational dot, fed a
 * single already-resolved `status` (from `usePresence`'s batched lookup, not
 * its own fetch). Renders nothing while presence hasn't loaded yet rather
 * than guessing a default tone, same "don't show a wrong state" discipline
 * `StatusDot`'s other callers already follow.
 */
export function PresenceDot({ status, className }: { status: string | undefined; className?: string }) {
  if (!status) return null;
  return (
    <Tooltip content={STATUS_LABEL[status] ?? status}>
      <StatusDot tone={STATUS_TONE[status] ?? "neutral"} className={className} />
    </Tooltip>
  );
}
