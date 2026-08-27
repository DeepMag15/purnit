"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { iconFor } from "./icons";

export interface CommandItem {
  id: string;
  label: string;
  icon?: string;
  onSelect: () => void;
}

/**
 * Quick-jump palette. Items come from `manifest.navigation` (see
 * `WorkspaceLayout`) — already pruned/compiled per the user's permissions,
 * not a hardcoded route list, so a Member never sees a palette entry for a
 * page they couldn't otherwise navigate to.
 *
 * Controlled `open`/`onClose`, mirroring `Dialog`'s own exact contract —
 * the parent owns *when* it opens (the Cmd/Ctrl+K global shortcut now lives
 * in `WorkspaceLayout`, which is also where the visible header search
 * trigger lives), while this component still self-manages `Escape`-to-close
 * and backdrop-click-to-close, same split of responsibility `Dialog` uses.
 */
export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: CommandItem[] }) {
  const [query, setQuery] = useState("");
  // Same reasoning as Dialog.tsx's own onCloseRef — callers pass an inline
  // onClose, so its identity changes on every parent render; reading it via
  // a ref keeps this effect tied only to `open` actually changing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh] backdrop-enter"
      onClick={onClose}
    >
      <div
        className="glass-panel panel-enter w-full max-w-lg overflow-hidden rounded-xl border border-border shadow-2xl"
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
                onClose();
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-text transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover"
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
