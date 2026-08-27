"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

// Frontend Redesign, Phase 01 — no ambient shadow on any variant (design
// review's elevation doctrine: shadow is earned by true elevation, never
// decoration on an inline, in-flow control). `interactive-press` gives every
// variant the same press-feedback micro-interaction from the motion doctrine.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-surface text-text border border-border hover:bg-surface-hover",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-text-muted hover:text-text hover:bg-surface-hover",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "interactive-press inline-flex items-center justify-center rounded-md font-medium transition-colors duration-[var(--duration-base)] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
