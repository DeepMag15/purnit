"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cn } from "./utils";

const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Adapts CommandPalette.tsx's own overlay/backdrop/Escape pattern (the one
// existing modal-style precedent in this codebase) plus two genuinely new
// mechanisms with no prior precedent here: a Tab-cycling focus trap and
// restore-focus-to-trigger on close. Confirmed via research before writing
// this that no focus-trap mechanism exists anywhere else in the app.
export function Dialog({
  open,
  onClose,
  title,
  size = "md",
  variant = "modal",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg";
  /** "drawer" reuses every mechanism below (focus trap, Escape, restore-
   * focus) unchanged — only the outer positioning/animation differs: a
   * fixed-width panel anchored to the right edge, full height, instead of a
   * centered box. `size` is ignored for drawers (full-height panels use
   * their own fixed width). */
  variant?: "modal" | "drawer";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // Callers pass onClose as an inline arrow function, so its identity
  // changes on every parent render (e.g. every keystroke in a form field
  // above updates the form's state and re-renders the parent). Reading it
  // through a ref, updated every render but never a dependency itself,
  // keeps the effect below tied only to `open` actually transitioning —
  // not to every unrelated parent re-render — while still always calling
  // the latest onClose. Previously the effect re-ran on every keystroke,
  // yanking focus back to the trigger button and then back into the
  // dialog on every single character typed.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? panel)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const isDrawer = variant === "drawer";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm backdrop-enter",
        isDrawer ? "flex justify-end" : "flex items-center justify-center p-4",
      )}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "glass-panel overflow-y-auto border-border shadow-xl",
          isDrawer ? "drawer-enter h-full w-full max-w-md border-l" : cn("panel-enter w-full overflow-hidden rounded-xl border", SIZE_CLASSES[size]),
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface/95 px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold text-text">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text">
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
