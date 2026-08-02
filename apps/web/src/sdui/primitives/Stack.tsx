import { z } from "zod";
import type { CommonRenderProps } from "../registry";

export const StackSchema = z.object({
  direction: z.enum(["row", "column"]).optional(),
  gap: z.number().optional(),
});
type Props = z.infer<typeof StackSchema>;

// `gap` is blueprint-supplied and arbitrary — kept as inline style since a
// Tailwind utility class needs to exist in source at build time; everything
// else about layout uses classes.
export function Stack({ direction = "column", gap = 8, childNodes, renderChild }: Props & CommonRenderProps) {
  return (
    <div className="flex" style={{ flexDirection: direction, gap: `${gap}px` }}>
      {childNodes?.map(renderChild)}
    </div>
  );
}
