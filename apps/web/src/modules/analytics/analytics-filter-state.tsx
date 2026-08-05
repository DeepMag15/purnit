"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return isoDate(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

export type AnalyticsFilterKey = "departmentId" | "teamId" | "projectId" | "employeeId";

interface AnalyticsFilterState {
  from: string;
  to: string;
  departmentId?: string;
  teamId?: string;
  projectId?: string;
  employeeId?: string;
}

interface AnalyticsFilterValue extends AnalyticsFilterState {
  setFilter: (key: AnalyticsFilterKey, value: string | undefined) => void;
  setDateRange: (from: string, to: string) => void;
  /** Clears every entity filter (department/team/project/employee) but
   * leaves the date range untouched — used by the "Company" view preset. */
  clearEntityFilters: () => void;
}

function defaultState(): AnalyticsFilterState {
  return { from: daysAgo(30), to: isoDate(new Date()) };
}

const AnalyticsFilterContext = createContext<AnalyticsFilterValue | null>(null);

/**
 * Analytics-scoped filter state — deliberately separate from the shared,
 * page-scoped FilterStateProvider (sdui/filter-state.tsx), which resets on
 * every page navigation and only supports single-select filters. This one
 * wraps the whole AnalyticsDashboard tree (not remounted per view-preset
 * switch) so a manually-picked date range or department survives switching
 * between Company/Department/Team/Personal view tabs.
 */
export function AnalyticsFilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalyticsFilterState>(defaultState);

  const setFilter = useCallback((key: AnalyticsFilterKey, value: string | undefined) => {
    setState((current) => ({ ...current, [key]: value }));
  }, []);
  const setDateRange = useCallback((from: string, to: string) => {
    setState((current) => ({ ...current, from, to }));
  }, []);
  const clearEntityFilters = useCallback(() => {
    setState((current) => ({ from: current.from, to: current.to }));
  }, []);

  const value: AnalyticsFilterValue = { ...state, setFilter, setDateRange, clearEntityFilters };
  return <AnalyticsFilterContext.Provider value={value}>{children}</AnalyticsFilterContext.Provider>;
}

export function useAnalyticsFilters(): AnalyticsFilterValue {
  const ctx = useContext(AnalyticsFilterContext);
  if (!ctx) throw new Error("useAnalyticsFilters() called outside an AnalyticsFilterProvider");
  return ctx;
}
