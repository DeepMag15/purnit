import { useId, type TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

// Same label/error/hint/backward-compatible-bare-render contract as
// Input.tsx/Select.tsx — see their own doc comments for the reasoning.
export function Textarea({ className, label, error, hint, id, ...props }: Props) {
  const autoId = useId();
  const textareaId = id ?? autoId;
  const describedBy = error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined;

  const textareaEl = (
    <textarea
      id={textareaId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cn(
        "min-h-20 rounded-md border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent",
        error ? "border-danger" : "border-border",
        className,
      )}
      {...props}
    />
  );

  if (!label && !error && !hint) return textareaEl;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={textareaId} className="text-xs font-medium text-text">
          {label}
        </label>
      )}
      {textareaEl}
      {error && (
        <span id={`${textareaId}-error`} className="text-xs text-danger">
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={`${textareaId}-hint`} className="text-xs text-text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}
