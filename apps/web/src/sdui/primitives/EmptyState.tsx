import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { Icon } from "../../ui/Icon";
import { Button } from "../../ui/Button";

export const EmptyStateSchema = z.object({ message: z.string().optional() });
type Props = z.infer<typeof EmptyStateSchema>;

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

/**
 * Plain view, usable directly by other primitives (e.g. Table/List showing
 * "no rows") without going through the registry with dummy CommonRenderProps.
 *
 * Frontend Redesign, Phase 01 — the design review's empty-state pattern:
 * never a blank screen, a way forward when there's one to offer. `action`
 * is optional (existing bare `message`-only call sites are unaffected) —
 * only pass it where there's a real, obvious next step (e.g. "New Project"
 * on an empty Projects list), not reflexively on every empty state.
 */
export function EmptyStateView({
  message = "Nothing here yet.",
  icon = "inbox",
  action,
}: {
  message?: string;
  icon?: string;
  action?: EmptyStateAction;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10">
        <Icon name={icon} size={20} className="text-accent" />
      </span>
      <p className="text-sm text-text-muted">{message}</p>
      {action && (
        <Button size="sm" variant="secondary" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ message }: Props & CommonRenderProps) {
  return <EmptyStateView message={message} />;
}
