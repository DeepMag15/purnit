import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBulkSelection } from "./use-bulk-selection";

interface Row {
  id: string;
}

const rows: Row[] = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("useBulkSelection", () => {
  it("toggle adds and removes an id", () => {
    const { result } = renderHook(() => useBulkSelection(rows, (r) => r.id));
    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.selectedCount).toBe(1);

    act(() => result.current.toggle("a"));
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it("toggleAll selects every row, then clears on a second call", () => {
    const { result } = renderHook(() => useBulkSelection(rows, (r) => r.id));
    act(() => result.current.toggleAll());
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.allSelected).toBe(true);

    act(() => result.current.toggleAll());
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.allSelected).toBe(false);
  });

  it("clear empties the selection", () => {
    const { result } = renderHook(() => useBulkSelection(rows, (r) => r.id));
    act(() => {
      result.current.toggle("a");
      result.current.toggle("b");
    });
    expect(result.current.selectedCount).toBe(2);

    act(() => result.current.clear());
    expect(result.current.selectedCount).toBe(0);
  });

  it("allSelected is false for an empty row list even with zero selected", () => {
    const { result } = renderHook(() => useBulkSelection([] as Row[], (r) => r.id));
    expect(result.current.allSelected).toBe(false);
  });
});
