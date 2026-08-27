import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "./utils";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

// label/error/hint are additive — a bare <Select .../> with none of these
// renders the exact same unwrapped <select> as before, so every existing
// call site across the app (which never passes them) is unaffected.
export function Select({ className, children, label, error, hint, id, ...props }: Props) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;

  const selectEl = (
    <select
      id={selectId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cn(
        "h-9 rounded-md border bg-surface px-2.5 text-sm text-text transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent",
        error ? "border-danger" : "border-border",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );

  if (!label && !error && !hint) return selectEl;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-xs font-medium text-text">
          {label}
        </label>
      )}
      {selectEl}
      {error && (
        <span id={`${selectId}-error`} className="text-xs text-danger">
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={`${selectId}-hint`} className="text-xs text-text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
