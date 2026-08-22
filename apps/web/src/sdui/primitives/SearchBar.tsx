import { z } from "zod";
import { useState } from "react";
import type { CommonRenderProps } from "../registry";
import { Icon } from "../../ui/Icon";

export const SearchBarSchema = z.object({ placeholder: z.string().optional() });
type Props = z.infer<typeof SearchBarSchema>;

// Reference-fidelity/UI-audit pass — was local-state-only decoration with no
// way for a caller to ever read what was typed. Now a real controlled/
// uncontrolled hybrid (same shape as `ui/Input`): pass `value`+`onChange` to
// drive it from a parent (e.g. a data source's own `search` param, the way
// `documents.list` already supports — see DocumentsPanel.tsx, its first
// real adoption), or omit both for the old self-contained decorative
// behavior. `value`/`onChange` are plain extra props, not part of
// `SearchBarSchema`, since a blueprint-authored node has no page-level
// query-param plumbing to drive them yet (same boundary FilterBar's own
// blueprint-vs-plain-React split already draws).
interface SearchBarExtraProps {
  value?: string;
  onChange?: (value: string) => void;
}

export function SearchBar({ placeholder = "Search…", value: controlledValue, onChange }: Props & CommonRenderProps & SearchBarExtraProps) {
  const [localValue, setLocalValue] = useState("");
  const value = controlledValue ?? localValue;

  function handleChange(next: string) {
    if (onChange) onChange(next);
    else setLocalValue(next);
  }

  return (
    <div className="relative w-full">
      <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm text-text placeholder:text-text-muted transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
      />
    </div>
  );
}
