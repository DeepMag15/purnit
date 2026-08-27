"use client";

import { useState } from "react";

/**
 * Client-side page-slicing over an arbitrary array — extracts Table3's own
 * exact page-clamping logic (sdui/primitives/Table.tsx, left unchanged
 * there) rather than reinventing it, for the flat-`.map()` module
 * composites (TaskList, ProjectBoard, PatientsWorkspace, etc.) that aren't
 * table-shaped. `currentPage` is defensively clamped against a stale `page`
 * after `rows` shrinks (e.g. a filter narrowing the set), same as Table3.
 */
export function usePagination<T>(rows: T[], pageSize = 20) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  return { pageRows, page: currentPage, totalPages, setPage };
}
