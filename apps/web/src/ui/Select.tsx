import type { SelectHTMLAttributes } from "react";
import { cn } from "./utils";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-border bg-surface px-2.5 text-sm text-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
