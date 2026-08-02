"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BindExpr, DataBinding, UINode } from "@antigravity/manifest-schema";
import { useRenderContext } from "./render-context";
import { useFilterState } from "./filter-state";
import { getByPath } from "./interpolate";
import { callDataSourceBatch } from "../lib/api-client";

export interface DataBindingState {
  data: unknown;
  loading: boolean;
  error: string | null;
  /** Re-runs a `{source}` binding's fetch (no-op for `{const}`/`{ref}`).
   * Callers that mutate data the binding depends on (e.g. a create/delete
   * action) should call this afterward rather than relying on the page to
   * reload. */
  refetch: () => void;
  /** This binding's exact TanStack Query cache key — an additive contract
   * extension (performance pass 2, CONTEXT.md §48), safe for every existing
   * consumer to ignore. Lets a caller optimistically patch its own cached
   * data via `queryClient.setQueryData(queryKey, ...)` ahead of a mutation's
   * round trip, rolling back on error, without duplicating this hook's key
   * construction. `readonly unknown[]` for `{const}`/`{ref}` bindings (never
   * actually queried, so patching it is a no-op either way). */
  queryKey: readonly unknown[];
}

export function resolveBindExpr(expr: BindExpr, context: Record<string, unknown>): unknown {
  return "const" in expr ? expr.const : getByPath(context, expr.ref);
}

/** Shared with `WorkspaceSidebar`'s hover-intent prefetch (CONTEXT.md §48) —
 * both must build the identical key for a prefetch to actually land a cache
 * hit here rather than a second, wasted fetch. */
export function dataSourceQueryKey(source: string, params: Record<string, unknown>, tenantId: string, userId: string) {
  return ["dataSource", source, JSON.stringify(params), tenantId, userId] as const;
}

/**
 * Walks a fetched page tree collecting every `{source, params}` binding —
 * used by the sidebar's hover-intent prefetch to warm the query cache ahead
 * of a click (CONTEXT.md §48). Only ever finds *blueprint-bound* primitives
 * (`Table`/`List`/`Chart`/`KpiCard`, a composite's own primary `bind`) —
 * a composite's internal reference-data needs (e.g. `OrgStructure`'s
 * `departments.list`/`teams.list`/...) aren't expressed as a `bind` on any
 * node, so they can't be discovered statically without executing the
 * component; a real, disclosed limitation, not an oversight.
 */
export function collectSourceBindings(node: UINode): { source: string; params: Record<string, BindExpr> }[] {
  const results: { source: string; params: Record<string, BindExpr> }[] = [];
  function walk(n: UINode) {
    if (n.bind && !("const" in n.bind) && !("ref" in n.bind)) {
      results.push({ source: n.bind.source, params: n.bind.params ?? {} });
    }
    n.children?.forEach(walk);
  }
  walk(node);
  return results;
}

/**
 * The cached, deduped replacement for a composite's own ad hoc
 * `callDataSource(source, params).then(setState)` pattern (CONTEXT.md §48).
 * Before this, every composite (`OrgStructure`, and the reference-data
 * fetches inside `ProjectBoard`/`TaskList`/`TeamMembers`) hand-rolled its own
 * `useEffect`+`useState`, entirely bypassing `useDataBinding`'s cache below —
 * so two composites both needing `users.list` fired two separate network
 * calls, and revisiting a page refetched everything from a blank slate every
 * time. Same query-key scheme as `useDataBinding`, so a composite and a
 * blueprint-bound primitive asking for the same `source`+`params` share one
 * cache entry.
 */
export function useDataSourceQuery<T = unknown>(
  source: string,
  params: Record<string, unknown> = {},
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  const { user, tenant, callDataSource } = useRenderContext();
  const queryKey = dataSourceQueryKey(source, params, tenant.id, user.id);
  return useQuery<T>({
    queryKey,
    queryFn: () => callDataSource(source, params) as Promise<T>,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * Fetches several data sources in one round trip via `POST /api/data/batch`
 * (CONTEXT.md §48) — for a composite like `OrgStructure` that needs 3-4
 * sources at once and previously fired that many separate requests (and
 * backend transactions) on every mount. Each result is also seeded into the
 * same per-source cache `useDataSourceQuery`/`useDataBinding` read from
 * (`queryClient.setQueryData`), so anything else on the page asking for one
 * of these exact source+params gets an instant cache hit instead of a fifth
 * network call.
 */
export function useDataSourceBatchQuery(requests: { source: string; params?: Record<string, unknown> }[]) {
  const { user, tenant } = useRenderContext();
  const queryClient = useQueryClient();
  const requestsKey = JSON.stringify(requests);

  const query = useQuery({
    queryKey: ["dataSourceBatch", requestsKey, tenant.id, user.id],
    queryFn: async () => {
      const results = await callDataSourceBatch(requests);
      results.forEach((result, i) => {
        const req = requests[i];
        if (req && result.data !== undefined) {
          queryClient.setQueryData(dataSourceQueryKey(req.source, req.params ?? {}, tenant.id, user.id), result.data);
        }
      });
      return results;
    },
    enabled: requests.length > 0,
  });

  return { results: query.data ?? [], isPending: query.isPending, refetch: query.refetch };
}

/**
 * Resolves a UINode's `bind` into live state. `{const}`/`{ref}` resolve
 * synchronously from the render context; `{source, params}` calls
 * `POST /api/data/:source` through TanStack Query (CONTEXT.md §48) — request
 * dedup across components sharing a source+params, stale-while-revalidate
 * (paint from cache instantly, revalidate silently — no `loading` flicker on
 * a background refresh, since `loading` maps to `isPending`, true only
 * before any data has ever arrived), and the same cache the sidebar's
 * hover-intent prefetch populates ahead of a click.
 *
 * The pass-1 filter-cascade fix (only refetch when a binding's own `params`
 * actually reference a changed filter) falls out of this for free now: the
 * query key *is* the resolved `params` object, which only ever contains the
 * specific filter values this binding's `ref`s named — an unrelated
 * `FilterBar` elsewhere on the page can't change it.
 */
export function useDataBinding(bind: DataBinding | undefined): DataBindingState {
  const { user, tenant, callDataSource } = useRenderContext();
  const { filters } = useFilterState();
  const queryClient = useQueryClient();

  const isSourceBinding = !!bind && !("const" in bind) && !("ref" in bind);
  const context = { user, tenant, filters };
  const params = isSourceBinding
    ? Object.fromEntries(
        Object.entries((bind as { params?: Record<string, BindExpr> }).params ?? {}).map(([key, expr]) => [
          key,
          resolveBindExpr(expr, context),
        ]),
      )
    : {};
  const source = isSourceBinding ? (bind as { source: string }).source : "";
  const queryKey = dataSourceQueryKey(source, params, tenant.id, user.id);

  const query = useQuery({
    queryKey,
    queryFn: () => callDataSource(source, params),
    enabled: isSourceBinding,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
    // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- a dynamic-length deps array is deliberate here: queryKey's own elements are the real deps, re-derived identically above every render
  }, [queryClient, ...queryKey]);

  if (!bind) return { data: undefined, loading: false, error: null, refetch, queryKey };
  if ("const" in bind) return { data: bind.const, loading: false, error: null, refetch, queryKey };
  if ("ref" in bind) return { data: getByPath(context, bind.ref), loading: false, error: null, refetch, queryKey };

  return {
    data: query.data,
    loading: query.isPending,
    error: query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null,
    refetch,
    queryKey,
  };
}
