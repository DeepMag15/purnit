import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./utils";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

// Same sr-only-native-input + peer-checked pattern as Checkbox.tsx/Radio.tsx.
// The thumb slides via `transform` (translate-x), an allowed animated
// property per the motion-token rule (never a layout-affecting property).
export function Switch({ checked, label, id, className, ...props }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn("inline-flex cursor-pointer items-center gap-2 select-none", className)}>
      <input id={inputId} type="checkbox" role="switch" checked={checked} className="peer sr-only" {...props} />
      <span className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-surface-hover transition-colors duration-[var(--duration-fast)] peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50">
        <span
          className={cn(
            "h-3.5 w-3.5 rounded-full bg-surface shadow-sm transition-transform duration-[var(--duration-fast)] ease-standard",
            checked ? "translate-x-4" : "translate-x-1",
          )}
        />
      </span>
      {label && <span className="text-sm text-text">{label}</span>}
    </label>
  );
}
