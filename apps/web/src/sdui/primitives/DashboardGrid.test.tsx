import { describe, it, expect } from "vitest";
import { autoLayout, mergeLayout } from "./DashboardGrid";

// Same "test the pure logic, not the full react-grid-layout drag
// interaction" precedent AnalyticsDashboard.tsx's own equivalent functions
// have always followed (it has no dedicated test file either).
describe("autoLayout", () => {
  it("lays widgets out two per row, all visible, in a flowing 12-column grid", () => {
    const result = autoLayout(["a", "b", "c"]);
    expect(result).toEqual([
      { key: "a", visible: true, x: 0, y: 0, w: 6, h: 4 },
      { key: "b", visible: true, x: 6, y: 0, w: 6, h: 4 },
      { key: "c", visible: true, x: 0, y: 4, w: 6, h: 4 },
    ]);
  });

  it("returns an empty array for no widgets", () => {
    expect(autoLayout([])).toEqual([]);
  });
});

describe("mergeLayout", () => {
  it("falls back to autoLayout when there is no saved layout", () => {
    expect(mergeLayout(["a", "b"], undefined)).toEqual(autoLayout(["a", "b"]));
  });

  it("falls back to autoLayout when the saved layout is an empty array", () => {
    expect(mergeLayout(["a", "b"], [])).toEqual(autoLayout(["a", "b"]));
  });

  it("keeps a saved entry's position/size for a widget still present in children", () => {
    const saved = [{ key: "a", visible: true, x: 3, y: 1, w: 4, h: 5 }];
    const result = mergeLayout(["a"], saved);
    expect(result).toEqual([{ key: "a", visible: true, x: 3, y: 1, w: 4, h: 5 }]);
  });

  it("drops a saved entry for a widget no longer present in children", () => {
    const saved = [
      { key: "a", visible: true, x: 0, y: 0, w: 6, h: 4 },
      { key: "gone", visible: true, x: 6, y: 0, w: 6, h: 4 },
    ];
    const result = mergeLayout(["a"], saved);
    expect(result).toEqual([{ key: "a", visible: true, x: 0, y: 0, w: 6, h: 4 }]);
  });

  it("auto-appends a widget present in children but absent from the saved layout, below the lowest existing item", () => {
    const saved = [{ key: "a", visible: true, x: 0, y: 0, w: 6, h: 4 }];
    const result = mergeLayout(["a", "new"], saved);
    expect(result).toEqual([
      { key: "a", visible: true, x: 0, y: 0, w: 6, h: 4 },
      { key: "new", visible: true, x: 0, y: 4, w: 6, h: 4 },
    ]);
  });

  it("preserves saved ordering and visibility, never reordering or resurfacing hidden widgets", () => {
    const saved = [
      { key: "a", visible: false, x: 0, y: 0, w: 6, h: 4 },
      { key: "b", visible: true, x: 6, y: 0, w: 6, h: 4 },
    ];
    const result = mergeLayout(["a", "b"], saved);
    expect(result).toEqual(saved);
  });
});
