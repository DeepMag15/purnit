"use client";

import { useDataSourceQuery } from "./use-data-binding";
import { ApiError } from "../lib/api-client";

export interface EntityDetailState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

/**
 * Frontend Structural Redesign, Phase 0 — the shared data-fetch shape for
 * every dedicated detail-page route (/workspace/<module>/[id]), a thin
 * wrapper over the existing useDataSourceQuery. Every `*.detail` data
 * source throws a 404 NotFoundException for both "doesn't exist" and
 * "exists but out of scope" (the same fold-visibility-into-the-query
 * precedent document.detail already established) — `notFound` recognizes
 * that status code so every detail page renders the same "not found or you
 * don't have access" empty state instead of a raw error dump.
 */
export function useEntityDetail<T>(source: string, id: string | undefined): EntityDetailState<T> {
  const { data, isPending, error, refetch } = useDataSourceQuery<T>(source, { id: id ?? "" }, { enabled: !!id });
  return {
    data,
    loading: !!id && isPending,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    notFound: !id || (error instanceof ApiError && error.status === 404),
    refetch: () => void refetch(),
  };
}
