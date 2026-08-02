import { z } from "zod";
import { List as VirtualList, type RowComponentProps } from "react-window";
import type { ActionSpec } from "@antigravity/manifest-schema";
import type { CommonRenderProps } from "../registry";
import { useDataBinding } from "../use-data-binding";
import { useActionDispatch } from "../use-action-dispatch";
import { EmptyStateView } from "./EmptyState";
import { SkeletonRows } from "../../ui/Skeleton";
import { Alert } from "../../ui/Alert";

export const ListSchema = z.object({ titleField: z.string().optional() });
type Props = z.infer<typeof ListSchema>;

// Performance pass 2 (CONTEXT.md §48): building-block, not a fix for today's
// data — every real tenant's row counts are far below this threshold right
// now (confirmed directly), so this branch is inert in practice. Kept
// deliberately conservative (only kicks in for genuinely large lists) rather
// than virtualizing unconditionally, since a virtualized list is a real
// structural change (a fixed-height scroll viewport of absolutely-positioned
// rows, not a plain flow layout) that isn't worth paying for below this size.
const VIRTUALIZE_THRESHOLD = 50;
const ROW_HEIGHT = 41;

interface ListRowProps {
  rows: Record<string, unknown>[];
  titleField: string;
  navigateAction: ActionSpec | undefined;
  dispatch: (action: ActionSpec, row?: unknown) => Promise<void>;
}

function ListRow({ ariaAttributes, index, style, rows, titleField, navigateAction, dispatch }: RowComponentProps<ListRowProps>) {
  const row = rows[index]!;
  return (
    <div
      {...ariaAttributes}
      style={style}
      onClick={navigateAction ? () => dispatch(navigateAction, row) : undefined}
      className={
        "flex items-center border-b border-border text-sm text-text" + (navigateAction ? " cursor-pointer transition-colors duration-150 hover:text-accent" : "")
      }
    >
      {String(row[titleField] ?? "")}
    </div>
  );
}

export function List({ titleField = "name", bind, actions }: Props & CommonRenderProps) {
  const { data, loading, error } = useDataBinding(bind);
  const dispatch = useActionDispatch();

  if (loading) return <SkeletonRows />;
  if (error) return <Alert tone="danger">Couldn&apos;t load data: {error}</Alert>;

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  if (rows.length === 0) return <EmptyStateView />;

  const navigateAction = actions?.find((a) => a.kind === "navigate");

  if (rows.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualList
        rowComponent={ListRow}
        rowCount={rows.length}
        rowHeight={ROW_HEIGHT}
        rowProps={{ rows, titleField, navigateAction, dispatch }}
        style={{ height: Math.min(rows.length * ROW_HEIGHT, 480) }}
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row, i) => (
        <li
          key={String(row.id ?? i)}
          onClick={navigateAction ? () => dispatch(navigateAction, row) : undefined}
          className={
            "py-2.5 text-sm text-text" + (navigateAction ? " cursor-pointer transition-colors duration-150 hover:text-accent" : "")
          }
        >
          {String(row[titleField] ?? "")}
        </li>
      ))}
    </ul>
  );
}
