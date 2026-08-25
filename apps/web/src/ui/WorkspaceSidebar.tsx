"use client";

import { useState } from "react";
import Link from "next/link";
import type { NavItem, WorkspaceManifest } from "@purnit/manifest-schema";
import { Icon } from "./Icon";
import { iconFor } from "./icons";
import { Tooltip } from "./Tooltip";
import { cn } from "./utils";

// Frontend Redesign, Phase 02 — module-by-module opt-out of the generic
// `/workspace/[pageId]` catch-all, same "kill the renderer module by
// module" architecture Phase 01 already applied to the landing dashboard.
// Deliberately a frontend-only lookup, not a backend nav/pageId change —
// the blueprint's own `pageId` strings stay exactly as seed.ts already
// defines them; this just redirects where they resolve to once a module
// has a real, purpose-built route. Add an entry here whenever a module
// migrates off the catch-all.
const DEDICATED_ROUTES: Record<string, string> = {
  "page.calendar": "/workspace/calendar",
  "page.meetings": "/workspace/meetings",
  "page.attendance": "/workspace/attendance",
  "page.analytics": "/workspace/analytics",
  "page.chat": "/workspace/chat",
  "page.leave": "/workspace/leave",
  "page.crm": "/workspace/crm",
  "page.audit-logs": "/workspace/audit-logs",
  "page.settings": "/workspace/settings",
  "page.roles-permissions": "/workspace/roles-permissions",
  "page.hr": "/workspace/hr",
  "page.patients": "/workspace/patients",
  "page.appointments": "/workspace/appointments",
  "page.students": "/workspace/students",
  "page.courses": "/workspace/courses",
  "page.clients": "/workspace/clients",
  "page.invoices": "/workspace/invoices",
  "page.inventory-items": "/workspace/inventory-items",
  "page.suppliers": "/workspace/suppliers",
  "page.purchase-orders": "/workspace/purchase-orders",
  "page.work-orders": "/workspace/work-orders",
};

/** Same root-page special-case as the old inline block had — kept here so
 * every consumer (this component, the command palette, QuickActions) computes
 * hrefs identically. Returns `undefined` for a pure disclosure group (no
 * `pageId` of its own) — nothing to link to, expand/collapse only. */
export function hrefForNavItem(manifest: WorkspaceManifest, pageId: string | undefined): string | undefined {
  if (pageId === undefined) return undefined;
  if (DEDICATED_ROUTES[pageId]) return DEDICATED_ROUTES[pageId];
  return pageId === manifest.page.id ? "/workspace" : `/workspace/${encodeURIComponent(pageId)}`;
}

function containsActiveHref(item: NavItem, manifest: WorkspaceManifest, pathname: string): boolean {
  if (hrefForNavItem(manifest, item.pageId) === pathname) return true;
  return item.children?.some((child) => containsActiveHref(child, manifest, pathname)) ?? false;
}

interface WorkspaceSidebarProps {
  items: NavItem[];
  manifest: WorkspaceManifest;
  pathname: string;
  /** Desktop icon-only rail mode — a CSS (`md:hidden`) concept, not a JS
   * branch: the mobile drawer always shows full labels/nesting regardless of
   * this flag, exactly like the flat list this replaces. */
  collapsed: boolean;
  /** Called on any leaf-link click — closes the mobile drawer. */
  onNavigate: () => void;
  /** Hover-intent prefetch (CONTEXT.md §48) — called with a leaf's `pageId`
   * on `onMouseEnter`, ahead of any click. Optional so this component stays
   * usable without it (e.g. in tests). */
  onHoverIntent?: (pageId: string) => void;
}

/**
 * Recursive nav renderer driven entirely by an already-permission-pruned
 * `NavItem[]` — zero role/permission conditionals here by design (see
 * ARCHITECTURE.md §7.8). A leaf (`pageId` present) is a link; a pure group
 * (`children` present, `pageId` absent) is an expand/collapse toggle only.
 */
export function WorkspaceSidebar({ items, manifest, pathname, collapsed, onNavigate, onHoverIntent }: WorkspaceSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderItems(list: NavItem[]) {
    return list.map((item) => {
      const href = hrefForNavItem(manifest, item.pageId);
      const isGroup = (item.children?.length ?? 0) > 0;
      const active = href !== undefined && pathname === href;
      // A group containing the active page stays visually expanded
      // regardless of manual toggle state — you can't collapse the group
      // whose page you're currently viewing.
      const isExpanded = isGroup && (expanded.has(item.id) || containsActiveHref(item, manifest, pathname));

      const groupRow = (
        <button
          type="button"
          onClick={() => toggle(item.id)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]",
            "text-text-muted hover:bg-surface-hover hover:text-text",
          )}
        >
          <Icon name={iconFor(item.icon)} size={20} className="shrink-0" />
          <span className={cn("flex-1 text-left", collapsed && "md:hidden")}>{item.label}</span>
          <Icon name={isExpanded ? "expand_less" : "expand_more"} size={18} className={cn("shrink-0", collapsed && "md:hidden")} />
        </button>
      );
      const leafRow = (
        // Performance pass 2 (CONTEXT.md §48): this used to be a plain <a
        // href> — every click was a full browser navigation (refetch
        // bootstrap, tear down and remount the entire React tree), not a
        // client-side transition. `next/link` fixes that and prefetches the
        // target route's JS bundle for free; it renders an <a> under the
        // hood, so styling/props are unchanged.
        <Link
          href={href!}
          onClick={onNavigate}
          onMouseEnter={() => onHoverIntent?.(item.pageId!)}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]",
            // Frontend Redesign, Phase 01 — a soft surface pop, not a colored
            // block (design review's "active nav = soft fill, not a colored
            // block" doctrine). The sidebar itself sits on --surface-sunk
            // (WorkspaceLayout), so --surface reads as a genuine, subtle lift.
            active ? "bg-surface text-text shadow-xs" : "text-text-muted hover:bg-surface-hover hover:text-text",
          )}
        >
          <Icon name={iconFor(item.icon)} size={20} filled={active} className={cn("shrink-0", active && "text-accent")} />
          <span className={cn(collapsed && "md:hidden")}>{item.label}</span>
        </Link>
      );
      // Collapsed rail mode used to set a native `title` here for a
      // tooltip-on-hover fallback — swapped for the styled Tooltip
      // primitive (Phase B), same exact conditional. Not shown when
      // expanded/on the mobile drawer, where the label is already visible.
      const row = isGroup
        ? collapsed
          ? <Tooltip content={item.label}>{groupRow}</Tooltip>
          : groupRow
        : collapsed
          ? <Tooltip content={item.label}>{leafRow}</Tooltip>
          : leafRow;

      return (
        <div key={item.id}>
          {row}
          {isGroup && isExpanded && (
            <div className={cn("ml-3 flex flex-col gap-1 border-l border-border pl-2", collapsed && "md:hidden")}>
              {renderItems(item.children!)}
            </div>
          )}
        </div>
      );
    });
  }

  return <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">{renderItems(items)}</nav>;
}
