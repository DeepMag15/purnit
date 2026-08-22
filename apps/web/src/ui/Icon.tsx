import { cn } from "./utils";

/**
 * Renders a Material Symbols Outlined glyph — the font is a ligature font,
 * so `name` (e.g. "home", "task_alt") is the actual text content, not a
 * lookup key into a component map. See globals.css for the self-hosted
 * @font-face (via the `material-symbols` package) and the base
 * `.material-symbols-outlined` class this builds on.
 *
 * Frontend Redesign, Phase 01 — `filled` toggles the `.icon-filled` override
 * (globals.css), the iconography ruleset from the design review: outline at
 * rest, filled only for an active/selected state. Same glyph either way, so
 * a caller never needs a second icon name for "selected."
 */
export function Icon({ name, size = 20, className, filled }: { name: string; size?: number; className?: string; filled?: boolean }) {
  return (
    <span className={cn("material-symbols-outlined", filled && "icon-filled", className)} style={{ fontSize: size }} aria-hidden="true">
      {name}
    </span>
  );
}
