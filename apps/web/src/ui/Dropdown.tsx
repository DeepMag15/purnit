"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./utils";

export function Dropdown({
  trigger,
  children,
  align = "end",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={cn(
            "absolute top-[calc(100%+6px)] z-20 min-w-[180px] rounded-lg border border-border bg-surface py-1 shadow-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ onClick, children, danger }: { onClick?: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover",
        danger ? "text-danger" : "text-text",
      )}
    >
      {children}
    </button>
  );
}
