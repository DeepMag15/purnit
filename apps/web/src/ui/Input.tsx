import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./utils";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

// label/error/hint are additive — a bare <Input .../> with none of these
// renders the exact same unwrapped <input> as before, so every existing
// call site across the app (which never passes them) is unaffected.
export function Input({ className, label, error, hint, id, ...props }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  const inputEl = (
    <input
      id={inputId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cn(
        "h-9 rounded-md border bg-surface px-3 text-sm text-text placeholder:text-text-muted transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent",
        error ? "border-danger" : "border-border",
        className,
      )}
      {...props}
    />
  );

  if (!label && !error && !hint) return inputEl;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-text">
          {label}
        </label>
      )}
      {inputEl}
      {error && (
        <span id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={`${inputId}-hint`} className="text-xs text-text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
