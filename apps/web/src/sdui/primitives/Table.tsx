import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { useActionDispatch } from "../use-action-dispatch";
import { EmptyStateView } from "./EmptyState";
import { SkeletonRows } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";

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
              className={"transition-colors duration-150" + (navigateAction ? " cursor-pointer hover:bg-surface-hover" : "")}
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
