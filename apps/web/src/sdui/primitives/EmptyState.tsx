import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { Icon } from "../../ui/Icon";

export const EmptyStateSchema = z.object({ message: z.string().optional() });
type Props = z.infer<typeof EmptyStateSchema>;

/** Plain view, usable directly by other primitives (e.g. Table/List showing
 * "no rows") without going through the registry with dummy CommonRenderProps. */
export function EmptyStateView({ message = "Nothing here yet." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Icon name="inbox" size={22} className="text-text-muted" />
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}

export function EmptyState({ message }: Props & CommonRenderProps) {
  return <EmptyStateView message={message} />;
}
