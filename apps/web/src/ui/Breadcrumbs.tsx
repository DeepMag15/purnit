import type { NavItem } from "@purnit/manifest-schema";
import { Icon } from "./Icon";
import { cn } from "./utils";

// Renders nothing for a top-level page (no useful trail on its own) — most
// pages, having no parent group, never show a breadcrumb bar at all; only
// genuinely nested ones (e.g. "Employees" under "HR") do. A segment with no
// `pageId` (a pure disclosure group, like "HR" itself) is plain text even
// mid-path, since there's nowhere to navigate to. The last segment is
// always plain text (the current page, standard breadcrumb convention).
export function Breadcrumbs({ path, onNavigate }: { path: NavItem[]; onNavigate: (pageId: string) => void }) {
  if (path.length <= 1) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-text-muted">
      {path.map((item, i) => {
        const isLast = i === path.length - 1;
        return (
          <span key={item.id} className="flex items-center gap-1.5">
            {i > 0 && <Icon name="chevron_right" size={14} className="text-text-muted/60" />}
            {!isLast && item.pageId ? (
              <button
                type="button"
                onClick={() => onNavigate(item.pageId!)}
                className="transition-colors duration-[var(--duration-fast)] hover:text-text"
              >
                {item.label}
              </button>
            ) : (
              <span className={cn(isLast && "font-medium text-text")}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
