import { cn } from "./utils";

export type StatusTone = "queued" | "progress" | "review" | "done" | "danger" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  queued: "bg-queued",
  progress: "bg-warning",
  review: "bg-info",
  done: "bg-success",
  danger: "bg-danger",
  neutral: "bg-text-muted",
};

/**
 * Frontend Redesign, Phase 01 — the small dot-plus-label status vocabulary
 * from the design review (rounds 2-3), matched to `reference_design.png`'s
 * own To-do/In progress/Review/Complete pattern. One component, reused for
 * task status, invoice status, purchase order status, appointment status —
 * every workflow-state column in the app, rather than each module inventing
 * its own colored pill. `tone` is presentation only; callers map their own
 * domain status string ("todo" | "in_progress" | ...) to a tone themselves,
 * since the vocabulary differs per module and shouldn't be hardcoded here.
 */
export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", TONE_CLASSES[tone], className)} />;
}
