import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

/**
 * Frontend Redesign, Phase 01 (design review round 2) — rests on a 1px
 * border, not a shadow. Shadow is earned: dropdowns, dialogs, and
 * `interactive` cards on hover, never ambient at rest. `interactive` opts
 * into the `.interactive-lift` motion utility (globals.css) for cards that
 * are themselves clickable (e.g. a dashboard widget linking somewhere) —
 * a purely visual Card (e.g. a static form section) should not lift.
 */
export function Card({
  className,
  children,
  interactive,
  ...props
}: { children?: ReactNode; interactive?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface", interactive && "interactive-lift", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title?: ReactNode; action?: ReactNode }) {
  if (!title && !action) return null;
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
