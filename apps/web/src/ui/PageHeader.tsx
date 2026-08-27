import type { ReactNode } from "react";

/** Frontend Structural Redesign, Phase 0 — the shared top-of-page shell
 * every redesigned module adopts, replacing each module's own ad hoc header
 * row (a button here, a form-toggle there, no consistent placement). */
export function PageHeader({
  title,
  description,
  actions,
  search,
  viewSwitcher,
  filters,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  search?: ReactNode;
  viewSwitcher?: ReactNode;
  filters?: ReactNode;
}) {
  const hasSecondRow = !!(search || viewSwitcher || filters);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {hasSecondRow && (
        <div className="flex flex-wrap items-center gap-2">
          {search}
          {filters}
          {viewSwitcher && <div className="ml-auto">{viewSwitcher}</div>}
        </div>
      )}
    </div>
  );
}
