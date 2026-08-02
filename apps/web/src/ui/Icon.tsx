import { cn } from "./utils";

/**
 * Renders a Material Symbols Outlined glyph — the font is a ligature font,
 * so `name` (e.g. "home", "task_alt") is the actual text content, not a
 * lookup key into a component map. See globals.css for the self-hosted
 * @font-face (via the `material-symbols` package) and the base
 * `.material-symbols-outlined` class this builds on.
 */
export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <span className={cn("material-symbols-outlined", className)} style={{ fontSize: size }} aria-hidden="true">
      {name}
    </span>
  );
}
