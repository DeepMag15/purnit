import { useId, type InputHTMLAttributes } from "react";
import { Icon } from "./Icon";
import { cn } from "./utils";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

// Native <input type="checkbox"> stays in the DOM (sr-only) so keyboard/
// screen-reader support (Space toggles it) comes free, no custom keydown
// handling needed. The visible box is a sibling styled via peer-checked/
// peer-focus-visible; the checkmark itself is driven directly from the
// `checked` prop rather than CSS visibility, since this is already a
// controlled component.
export function Checkbox({ checked, label, id, className, ...props }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn("inline-flex cursor-pointer items-center gap-2 select-none", className)}>
      <input id={inputId} type="checkbox" checked={checked} className="peer sr-only" {...props} />
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-surface transition-colors duration-[var(--duration-fast)] peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50">
        {checked && <Icon name="check" size={12} className="text-accent-fg" />}
      </span>
      {label && <span className="text-sm text-text">{label}</span>}
    </label>
  );
}
