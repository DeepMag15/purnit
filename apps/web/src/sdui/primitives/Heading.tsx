import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useRenderContext } from "../render-context";
import { interpolate } from "../interpolate";
import { cn } from "../../ui/utils";

export const HeadingSchema = z.object({
  text: z.string(),
  level: z.number().int().min(1).max(6).optional(),
});
type Props = z.infer<typeof HeadingSchema>;

const TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const SIZE_CLASSES = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"] as const;

export function Heading({ text, level = 2 }: Props & CommonRenderProps) {
  const { user, tenant } = useRenderContext();
  const resolved = interpolate(text, { user, tenant });
  const Tag = TAGS[level - 1] ?? "h2";
  return <Tag className={cn("font-semibold tracking-tight text-text", SIZE_CLASSES[level - 1] ?? "text-xl")}>{resolved}</Tag>;
}
