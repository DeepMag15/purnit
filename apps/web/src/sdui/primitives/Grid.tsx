import { z } from "zod";
import type { CommonRenderProps } from "../registry";

export const GridSchema = z.object({
  cols: z.number().int().positive(),
  gap: z.number().optional(),
});
type Props = z.infer<typeof GridSchema>;

// `cols`/`gap` are blueprint-supplied and arbitrary, so they stay inline
// style (a Tailwind class needs to exist in source at build time to be
// generated) — but the grid stacks to a single column below `md` regardless
// of the configured column count, via the responsive class below.
export function Grid({ cols, gap = 16, childNodes, renderChild }: Props & CommonRenderProps) {
  return (
    <div
      className="grid grid-cols-1 md:[grid-template-columns:var(--grid-cols)]"
      style={{ gap: `${gap}px`, ["--grid-cols" as string]: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {childNodes?.map(renderChild)}
    </div>
  );
}
