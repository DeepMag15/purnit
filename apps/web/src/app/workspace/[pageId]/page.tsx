"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { UINode } from "@antigravity/manifest-schema";
import { getWorkspacePage, ApiError } from "../../../lib/api-client";
import { Renderer } from "../../../sdui/renderer";
import { FilterStateProvider } from "../../../sdui/filter-state";
import { Skeleton } from "../../../ui/Skeleton";
import { Alert } from "../../../ui/Alert";

export default function WorkspacePage() {
  const params = useParams<{ pageId: string }>();
  const [page, setPage] = useState<UINode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(null);
    setError(null);
    getWorkspacePage(params.pageId)
      .then(setPage)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to load page");
      });
  }, [params.pageId]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!page) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  return (
    <FilterStateProvider key={page.id}>
      <Renderer node={page} />
    </FilterStateProvider>
  );
}
