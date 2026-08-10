"use client";

import { cloneElement, useId, type ReactElement } from "react";

// CSS-only positioning and visibility (no JS show/hide state, no new
// positioning-library dependency) — a simple above-trigger bubble needs no
// collision-detection engine. Shown via Tailwind's group-hover/group-focus-
// within, faded with the new motion tokens.
export function Tooltip({ content, children }: { content: string; children: ReactElement<{ "aria-describedby"?: string }> }) {
  const id = useId();
  return (
    <span className="group relative inline-block">
      {cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs text-bg opacity-0 shadow-md transition-opacity duration-[var(--duration-fast)] ease-standard group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
