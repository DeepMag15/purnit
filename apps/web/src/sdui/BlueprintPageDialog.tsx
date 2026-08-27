"use client";

import { useEffect, useState } from "react";
import type { UINode } from "@purnit/manifest-schema";
import { getWorkspacePage, ApiError } from "../lib/api-client";
import { Renderer } from "./renderer";
import { FilterStateProvider } from "./filter-state";
import { Dialog } from "../ui/Dialog";
import { Skeleton } from "../ui/Skeleton";
import { Alert } from "../ui/Alert";

// A `Page` node carries no title of its own (the heading, if any, is a
// child node rendered as content) — Dialog's own header bar (and its close
// button) only renders when `title` is truthy, so this derives a readable
// fallback from the pageId itself rather than leaving the dialog with no
// visible close affordance. "page.team-management" -> "Team management".
function titleFromPageId(pageId: string): string {
  const slug = pageId.replace(/^page\./, "").replace(/[-_]+/g, " ");
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Backs the `openModal`/`openDrawer` ActionSpec kinds (useActionDispatch.ts)
 * — the same fetch-a-page-by-id-and-render-it logic `/workspace/[pageId]`
 * already has, just mounted inside `Dialog` instead of a route. One
 * component serves both action kinds; only `variant` differs (`Dialog`
 * itself owns the modal/drawer visual distinction).
 */
export function BlueprintPageDialog({
  pageId,
  variant,
  onClose,
}: {
  pageId: string | null;
  variant: "modal" | "drawer";
  onClose: () => void;
}) {
  const [page, setPage] = useState<UINode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pageId) return;
    setPage(null);
    setError(null);
    getWorkspacePage(pageId)
      .then(setPage)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to load page");
      });
  }, [pageId]);

  return (
    <Dialog open={pageId !== null} onClose={onClose} variant={variant} size="lg" title={pageId ? titleFromPageId(pageId) : undefined}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!error && !page && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
      {!error && page && (
        <FilterStateProvider key={page.id}>
          <Renderer node={page} />
        </FilterStateProvider>
      )}
    </Dialog>
  );
}
