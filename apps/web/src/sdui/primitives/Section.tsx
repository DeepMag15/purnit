import { z } from "zod";
import type { CommonRenderProps } from "../registry";

export const SectionSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof SectionSchema>;

export function Section({ title, childNodes, renderChild }: Props & CommonRenderProps) {
  return (
    <section className="flex flex-col gap-3">
      {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
      {childNodes?.map(renderChild)}
    </section>
  );
}
