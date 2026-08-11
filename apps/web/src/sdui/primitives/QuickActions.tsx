import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useRenderContext } from "../render-context";
import { useBootstrap } from "../../app/workspace/bootstrap-context";
import { Card, CardHeader, CardBody } from "../../ui/Card";
import { Icon } from "../../ui/Icon";
import { flattenNavItems } from "../../ui/nav-tree";

const QuickActionItemSchema = z.object({ label: z.string(), icon: z.string(), pageId: z.string() });

/** Config-driven dashboard shortcuts — each item navigates to an existing
 * page (reusing RenderContext's own `navigate`), not a new action-dispatch
 * mechanism. Deliberately limited to real destinations already reachable in
 * this system; a blueprint author shouldn't add an item pointing at a page
 * that doesn't exist. */
export const QuickActionsSchema = z.object({
  title: z.string().optional(),
  items: z.array(QuickActionItemSchema),
});
type Props = z.infer<typeof QuickActionsSchema>;

export function QuickActions({ title, items }: Props & CommonRenderProps) {
  const { navigate } = useRenderContext();
  const { manifest } = useBootstrap();

  // `items` is static blueprint data with no per-user pruning, unlike
  // `manifest.navigation` (already permission-pruned server-side). Without
  // this filter, a role lacking access to a target page would see a working-
  // looking button that leads to a 404 — cross-check against the nav the
  // compiler already decided this user can see, same "prune, not hide"
  // principle, applied client-side since this data never went through the
  // server's own pruning pass. Flattened so a target page nested under a
  // group (e.g. "Team" under "HR") is still found, not just top-level items.
  const navPageIds = flattenNavItems(manifest.navigation).map((nav) => nav.pageId);
  const visibleItems = items.filter((item) => navPageIds.includes(item.pageId));

  if (visibleItems.length === 0) return null;

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="grid grid-cols-2 gap-2">
        {visibleItems.map((item) => (
          <button
            key={item.pageId}
            type="button"
            onClick={() => navigate(item.pageId)}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border p-4 text-text-muted transition-colors duration-[var(--duration-fast)] hover:bg-surface-hover hover:text-text"
          >
            <Icon name={item.icon} size={20} />
            <span className="text-[11px] font-medium">{item.label}</span>
          </button>
        ))}
      </CardBody>
    </Card>
  );
}
