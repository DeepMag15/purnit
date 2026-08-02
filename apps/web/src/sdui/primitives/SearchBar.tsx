import { z } from "zod";
import { useState } from "react";
import type { CommonRenderProps } from "../registry";
import { Icon } from "../../ui/Icon";

export const SearchBarSchema = z.object({ placeholder: z.string().optional() });
type Props = z.infer<typeof SearchBarSchema>;

// Local input state only — not yet wired back into a page-level query param
// data bindings read from (unlike FilterBar, which now is — see
// filter-state.tsx). No blueprint page needs live search yet; revisit
// together with FilterBar's mechanism if one does.
export function SearchBar({ placeholder = "Search…" }: Props & CommonRenderProps) {
  const [value, setValue] = useState("");
  return (
    <div className="relative w-full">
      <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm text-text placeholder:text-text-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
      />
    </div>
  );
}
