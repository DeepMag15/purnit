"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface FilterStateValue {
  filters: Record<string, unknown>;
  setFilter: (key: string, value: unknown) => void;
}

const noop: FilterStateValue = { filters: {}, setFilter: () => {} };

const FilterStateContext = createContext<FilterStateValue | null>(null);

/**
 * Page-scoped filter state — the third `{ ref: ... }` namespace alongside
 * `user`/`tenant` in `use-data-binding.ts`. Mounted once per rendered page
 * (`workspace/page.tsx`, `workspace/[pageId]/page.tsx`), keyed by page id so
 * navigating to a different page always starts with empty filters rather
 * than carrying over a same-named field's stale value.
 */
export function FilterStateProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const setFilter = useCallback((key: string, value: unknown) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);
  return <FilterStateContext.Provider value={{ filters, setFilter }}>{children}</FilterStateContext.Provider>;
}

// Non-throwing on purpose (unlike useRenderContext) — a data-bound node
// resolving `{ ref: "filters.x" }` on a page with no FilterBar/provider
// mounted should just see an empty filter set, not crash the page.
export function useFilterState(): FilterStateValue {
  return useContext(FilterStateContext) ?? noop;
}
