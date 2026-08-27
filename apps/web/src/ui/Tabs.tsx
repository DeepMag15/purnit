"use client";

import { useRef } from "react";
import { cn } from "./utils";

export interface TabItem {
  id: string;
  label: string;
}

// A tab-strip only — deliberately does not own panel rendering. The caller
// conditionally renders its own panel content based on the controlled
// `activeId`, matching this codebase's existing bias toward small, focused,
// composable primitives (Dropdown doesn't own its content either) rather
// than a heavier compound-component API.
export function Tabs({ items, activeId, onChange }: { items: TabItem[]; activeId: string; onChange: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const currentIndex = items.findIndex((i) => i.id === activeId);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.id);
    containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  return (
    <div
      ref={containerRef}
      role="tablist"
      className="flex items-center gap-1 overflow-x-auto border-b border-border"
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]",
              active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
