"use client";

import { useState } from "react";

/**
 * A generic Set<string>-of-selected-ids manager — deliberately makes no
 * assumption about what "bulk action" a composite eventually wires it to
 * (bulk task-status-change and bulk patient-delete are different mutations
 * entirely); this hook only owns the selection state itself.
 */
export function useBulkSelection<T>(rows: T[], getId: (row: T) => string) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => (current.size === rows.length ? new Set() : new Set(rows.map(getId))));
  }

  function clear() {
    setSelected(new Set());
  }

  return {
    selected,
    toggle,
    toggleAll,
    clear,
    isSelected: (id: string) => selected.has(id),
    selectedCount: selected.size,
    allSelected: rows.length > 0 && selected.size === rows.length,
  };
}
