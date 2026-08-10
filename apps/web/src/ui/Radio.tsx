import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./utils";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

// Same sr-only-native-input + peer-checked pattern as Checkbox.tsx — see
// its own doc comment for why. A circular indicator with an inner filled
// dot shown only when checked.
export function Radio({ checked, label, id, className, ...props }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn("inline-flex cursor-pointer items-center gap-2 select-none", className)}>
      <input id={inputId} type="radio" checked={checked} className="peer sr-only" {...props} />
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-border transition-colors duration-[var(--duration-fast)] peer-checked:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50">
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>
      {label && <span className="text-sm text-text">{label}</span>}
    </label>
  );
}
