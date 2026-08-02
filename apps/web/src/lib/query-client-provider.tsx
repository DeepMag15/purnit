"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider as TanstackQueryClientProvider } from "@tanstack/react-query";

/**
 * Performance pass 2 (CONTEXT.md §48): the data-fetching cache underneath
 * `useDataBinding` — request dedup (two composites asking for the same
 * source+params share one network call), stale-while-revalidate (paint from
 * cache instantly, revalidate silently), and the prefetch API the sidebar's
 * hover-intent prefetch uses. `useState(() => new QueryClient())` (not a
 * module-level singleton) so each root layout mount gets its own client —
 * standard Next.js App Router guidance, avoids leaking state across
 * server-rendered requests.
 */
export function QueryClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data sources are re-checked on every mount anyway via the
            // existing `refetch()`-on-mutation convention; a short
            // staleness window is enough to dedupe rapid remounts (e.g.
            // navigating away and back) without serving visibly outdated
            // data on genuinely separate visits.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 1,
          },
        },
      }),
  );
  return <TanstackQueryClientProvider client={client}>{children}</TanstackQueryClientProvider>;
}
