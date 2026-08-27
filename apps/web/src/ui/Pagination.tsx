import { Button } from "./Button";

// Extracted verbatim from Table3's own pagination logic (sdui/primitives/
// Table.tsx) — behavior-identical, just shared rather than inlined. Both
// directions self-clamp inside onChange independent of the disabled
// attribute, matching the original's own defensive double-clamp.
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
      <span>
        Page {page + 1} of {totalPages}
      </span>
      <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))}>
        Prev
      </Button>
      <Button size="sm" variant="secondary" disabled={page >= totalPages - 1} onClick={() => onChange(Math.min(totalPages - 1, page + 1))}>
        Next
      </Button>
    </div>
  );
}
