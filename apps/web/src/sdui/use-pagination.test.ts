import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagination } from "./use-pagination";

const rows = Array.from({ length: 25 }, (_, i) => i);

describe("usePagination", () => {
  it("slices the first page by default", () => {
    const { result } = renderHook(() => usePagination(rows, 10));
    expect(result.current.pageRows).toEqual(rows.slice(0, 10));
    expect(result.current.page).toBe(0);
    expect(result.current.totalPages).toBe(3);
  });

  it("advances to the requested page via setPage", () => {
    const { result } = renderHook(() => usePagination(rows, 10));
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    expect(result.current.pageRows).toEqual(rows.slice(20, 30));
  });

  it("clamps a stale page down when the row count shrinks (e.g. a filter narrowing the set)", () => {
    const { result, rerender } = renderHook(({ data }: { data: number[] }) => usePagination(data, 10), {
      initialProps: { data: rows },
    });
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);

    rerender({ data: rows.slice(0, 5) });
    expect(result.current.totalPages).toBe(1);
    expect(result.current.page).toBe(0);
    expect(result.current.pageRows).toEqual(rows.slice(0, 5));
  });

  it("always reports at least 1 total page, even for an empty array", () => {
    const { result } = renderHook(() => usePagination([] as number[], 10));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.pageRows).toEqual([]);
  });
});
