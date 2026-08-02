import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useRenderContext } from "../render-context";
import { interpolate } from "../interpolate";

export const TextSchema = z.object({ text: z.string() });
type Props = z.infer<typeof TextSchema>;

export function Text({ text }: Props & CommonRenderProps) {
  const { user, tenant } = useRenderContext();
  return <p className="text-sm text-text-muted">{interpolate(text, { user, tenant })}</p>;
}
