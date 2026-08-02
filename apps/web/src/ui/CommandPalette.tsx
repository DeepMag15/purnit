"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { iconFor } from "./icons";

export interface CommandItem {
  id: string;
  label: string;
  icon?: string;
  onSelect: () => void;
}

/**
 * Cmd/Ctrl+K quick-jump palette. Items come from `manifest.navigation` (see
 * `WorkspaceLayout`) — already pruned/compiled per the user's permissions,
 * not a hardcoded route list, so a Member never sees a palette entry for a
 * page they couldn't otherwise navigate to.
 */
export function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(
    () => (query.trim() ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())) : items),
    [items, query],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="glass-panel w-full max-w-lg overflow-hidden rounded-xl border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Icon name="search" size={16} className="text-text-muted shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to…"
            className="w-full bg-transparent text-sm text-text placeholder:text-text-muted outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 && <div className="px-3.5 py-6 text-center text-sm text-text-muted">No matches.</div>}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-text transition-colors duration-150 hover:bg-surface-hover"
            >
              <Icon name={iconFor(item.icon)} size={15} className="text-text-muted" />
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
