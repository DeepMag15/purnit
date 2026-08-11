import { Fragment, useState } from "react";
import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { useActionDispatch } from "../use-action-dispatch";
import { EmptyStateView } from "./EmptyState";
import { SkeletonRows } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Pagination } from "../../ui/Pagination";

export const TableSchema = z.object({ columns: z.array(z.string()) });
type Props = z.infer<typeof TableSchema>;

// "resource.action"-shaped labels (e.g. "project.delete") -> a short button
// label. Falls back to the raw mutation name for anything not listed.
const MUTATION_LABELS: Record<string, string> = {
  "project.delete": "Delete",
  "task.delete": "Delete",
};

export function Table({ columns, bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error, refetch } = useDataBinding(bind);
  const dispatch = useActionDispatch();

  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <Alert tone="danger">Couldn&apos;t load data: {error}</Alert>;

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (rows.length === 0) return <EmptyStateView />;

  const navigateAction = actions?.find((a) => a.kind === "navigate");
  const rowMutations = actions?.filter((a) => a.kind === "mutation") ?? [];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-hover">
            {columns.map((col) => (
              <th key={col} className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-text-muted">
                {col}
              </th>
            ))}
            {rowMutations.length > 0 && <th />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr
              key={String(row.id ?? i)}
              onClick={navigateAction ? () => dispatch(navigateAction, row) : undefined}
              className={"transition-colors duration-[var(--duration-fast)]" + (navigateAction ? " cursor-pointer hover:bg-surface-hover" : "")}
            >
              {columns.map((col) => (
                <td key={col} className="whitespace-nowrap px-3 py-2.5 text-text">
                  {String(row[col] ?? "")}
                </td>
              ))}
              {rowMutations.length > 0 && (
                <td className="px-3 py-2.5 text-right">
                  {rowMutations.map((action, idx) => (
                    <Button
                      key={idx}
                      variant="danger"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void dispatch(action, row).then(() => refetch());
                      }}
                    >
                      {action.kind === "mutation" ? (MUTATION_LABELS[action.mutation] ?? action.mutation) : action.kind}
                    </Button>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Phase C (Visual & Widget-Type Depth) — a new, more capable version
// registered alongside Table@2 (untouched, every existing blueprint usage
// keeps working unchanged), same versioned-primitive convention as every
// other primitive bump in this codebase. Adds client-side sort/filter/
// group/paginate over an already-fetched, already-capped row array — the
// same "fetch once, cheap, revisit only once real data volume justifies
// server-side paging" precedent every other list-shaped primitive here uses.
export const Table3Schema = z.object({
  columns: z.array(z.string()),
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  groupBy: z.string().optional(),
  pageSize: z.number().int().positive().default(20),
});
type Table3Props = z.infer<typeof Table3Schema>;

// Frontend Structural Redesign, Phase 0 — `onRowClick` is a purely additive
// escape hatch for a plain-React consumer (not a blueprint-authored node —
// a function prop can't be Zod-validated/JSON-serialized, so it's outside
// Table3Schema entirely) that needs to navigate to a *dynamic* per-row href
// (e.g. `/workspace/projects/${row.id}`). The existing `navigateAction`
// mechanism only ever resolves to a static blueprint pageId
// (`ActionSpec.to: string`, dispatched via the SDUI `navigate(pageId)`
// function) — it has no row-data interpolation, so it can't express "go to
// this specific record's own route." When both are omitted, behavior is
// byte-for-byte unchanged from before this prop existed.
interface Table3ExtraProps {
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function Table3({ columns, sortable, filterable, groupBy, pageSize, bind, actions, onRowClick }: Table3Props & CommonRenderProps & Table3ExtraProps) {
  const { data, loading, error, refetch } = useDataBinding(bind);
  const dispatch = useActionDispatch();
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <Alert tone="danger">Couldn&apos;t load data: {error}</Alert>;

  const allRows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (allRows.length === 0) return <EmptyStateView />;

  let rows = filterable
    ? allRows.filter((row) =>
        columns.every((col) => {
          const filterValue = columnFilters[col];
          if (!filterValue) return true;
          return String(row[col] ?? "").toLowerCase().includes(filterValue.toLowerCase());
        }),
      )
    : allRows;

  if (sortable && sortCol) {
    rows = [...rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  const groups: [string | null, Record<string, unknown>[]][] = groupBy
    ? Object.entries(
        pageRows.reduce<Record<string, Record<string, unknown>[]>>((acc, row) => {
          const key = String(row[groupBy] ?? "—");
          (acc[key] ??= []).push(row);
          return acc;
        }, {}),
      )
    : [[null, pageRows]];

  const navigateAction = actions?.find((a) => a.kind === "navigate");
  const rowMutations = actions?.filter((a) => a.kind === "mutation") ?? [];

  function toggleSort(col: string) {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-hover">
              {columns.map((col) => (
                <th
                  key={col}
                  className={"whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-text-muted" + (sortable ? " cursor-pointer select-none" : "")}
                  onClick={sortable ? () => toggleSort(col) : undefined}
                >
                  {col}
                  {sortable && sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              {rowMutations.length > 0 && <th />}
            </tr>
            {filterable && (
              <tr className="bg-surface-hover">
                {columns.map((col) => (
                  <th key={col} className="px-2 py-1.5">
                    <Input
                      className="h-7 w-full text-xs"
                      placeholder="Filter…"
                      value={columnFilters[col] ?? ""}
                      onChange={(e) => {
                        setColumnFilters((current) => ({ ...current, [col]: e.target.value }));
                        setPage(0);
                      }}
                    />
                  </th>
                ))}
                {rowMutations.length > 0 && <th />}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-border">
            {groups.map(([groupKey, groupRows]) => (
              <Fragment key={groupKey ?? "_"}>
                {groupKey !== null && (
                  <tr key={`group-${groupKey}`} className="cursor-pointer bg-surface-hover/60" onClick={() => toggleGroup(groupKey)}>
                    <td colSpan={columns.length + (rowMutations.length > 0 ? 1 : 0)} className="px-3 py-1.5 text-xs font-semibold text-text-muted">
                      {collapsedGroups.has(groupKey) ? "▶" : "▼"} {groupKey} ({groupRows.length})
                    </td>
                  </tr>
                )}
                {(groupKey === null || !collapsedGroups.has(groupKey)) &&
                  groupRows.map((row, i) => (
                    <tr
                      key={String(row.id ?? `${groupKey}-${i}`)}
                      onClick={onRowClick ? () => onRowClick(row) : navigateAction ? () => dispatch(navigateAction, row) : undefined}
                      className={"transition-colors duration-[var(--duration-fast)]" + (onRowClick || navigateAction ? " cursor-pointer hover:bg-surface-hover" : "")}
                    >
                      {columns.map((col) => (
                        <td key={col} className="whitespace-nowrap px-3 py-2.5 text-text">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                      {rowMutations.length > 0 && (
                        <td className="px-3 py-2.5 text-right">
                          {rowMutations.map((action, idx) => (
                            <Button
                              key={idx}
                              variant="danger"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                void dispatch(action, row).then(() => refetch());
                              }}
                            >
                              {action.kind === "mutation" ? (MUTATION_LABELS[action.mutation] ?? action.mutation) : action.kind}
                            </Button>
                          ))}
                        </td>
                      )}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
