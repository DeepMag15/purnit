import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useFilterState } from "../filter-state";
import { Select } from "../../ui/Select";

const FilterFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.literal("select"),
  options: z.array(z.string()),
});

export const FilterBarSchema = z.object({ filters: z.array(FilterFieldSchema) });
type Props = z.infer<typeof FilterBarSchema>;

// Fully config-driven and functional: which filters exist, their labels,
// and their option lists all come from the blueprint (`props.filters`) —
// nothing here is hardcoded per-page. Selecting a value writes to the
// page-scoped filter state (filter-state.tsx); any sibling node whose
// `bind.params` references `{ ref: "filters.<key>" }` re-fetches
// automatically (see use-data-binding.ts).
export function FilterBar({ filters }: Props & CommonRenderProps) {
  const { filters: values, setFilter } = useFilterState();

  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((field) => (
        <Select
          key={field.key}
          value={typeof values[field.key] === "string" ? (values[field.key] as string) : ""}
          onChange={(e) => setFilter(field.key, e.target.value || undefined)}
          className="w-auto"
        >
          <option value="">All {field.label.toLowerCase()}</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      ))}
    </div>
  );
}
