"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { Badge } from "./Badge";

/** Frontend Structural Redesign, Phase 0 — the shared shell for every
 * dedicated detail-page route (/workspace/<module>/[id]). Back-link, title +
 * status + actions row, optional tab strip, then a two-column body (main
 * content + a narrow metadata rail) collapsing to one stacked column below
 * `lg`. Every detail page composes this with module-specific tab content
 * built from already-existing pieces (CommentThread, DocumentsPanel, etc.). */
export function DetailPageShell({
  backHref,
  backLabel,
  title,
  status,
  actions,
  tabs,
  metadata,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  status?: { label: string; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent" };
  actions?: ReactNode;
  tabs?: ReactNode;
  metadata?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-sm text-text-muted transition-colors duration-[var(--duration-fast)] hover:text-text"
      >
        <Icon name="arrow_back" size={16} />
        {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {tabs}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">{children}</div>
        {metadata && <div className="w-full shrink-0 lg:w-72">{metadata}</div>}
      </div>
    </div>
  );
}
