import { Icon } from "./Icon";
import { cn } from "./utils";

export interface ViewOption {
  id: string;
  label: string;
  icon: string;
}

/** Frontend Structural Redesign, Phase 0 — the List/Board/Table/Timeline
 * toggle used by Projects/Tasks' PageHeader. A compact icon+label pill
 * group, visually distinct from Tabs' own underline strip. */
export function ViewSwitcher({ views, activeId, onChange }: { views: ViewOption[]; activeId: string; onChange: (id: string) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
      {views.map((view) => {
        const active = view.id === activeId;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onChange(view.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors duration-[var(--duration-fast)]",
              active ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-surface-hover hover:text-text",
            )}
          >
            <Icon name={view.icon} size={16} />
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
