import { cn } from "./utils";

const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Frontend Structural Redesign, Phase 0 — replaces plain assignee/owner
 * text wherever a person is referenced. Initials-only (no photo upload
 * exists anywhere in this codebase), a small addition to the existing
 * warm-neutral token system, not a new color. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-semibold text-accent", SIZE_CLASSES[size], className)}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
