import type { ReactNode } from "react";
import { Icon } from "./Icon";

// Renders nothing when nothing is selected. `children` is the composite's
// own action buttons (deliberately not hardcoded here — a composite passes
// whatever Buttons wired to its own mutations, e.g. bulk delete/bulk status
// change, since those vary per module).
export function BulkActionBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
      <span className="text-text">{count} selected</span>
      <div className="flex items-center gap-2">{children}</div>
      <button type="button" onClick={onClear} className="ml-auto text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
