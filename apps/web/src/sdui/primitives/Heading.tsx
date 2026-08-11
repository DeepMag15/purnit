import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useRenderContext } from "../render-context";
import { interpolate } from "../interpolate";
import { cn } from "../../ui/utils";

// `subtitle` (Frontend Structural Redesign, Phase 0) is additive — every
// existing Heading node omits it and renders byte-for-byte unchanged.
// Powers the new Dashboard hero band's one-line "what's happening" text
// without any new data source: it's a static, interpolated string, same
// mechanism `text` already uses, not a live summary of KPI values (those
// are independently bound to separate KpiCard nodes with no single place
// that already holds all of them — a real, disclosed simplification).
export const HeadingSchema = z.object({
  text: z.string(),
  level: z.number().int().min(1).max(6).optional(),
  subtitle: z.string().optional(),
});
type Props = z.infer<typeof HeadingSchema>;

const TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const SIZE_CLASSES = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"] as const;

export function Heading({ text, level = 2, subtitle }: Props & CommonRenderProps) {
  const { user, tenant } = useRenderContext();
  const resolved = interpolate(text, { user, tenant });
  const Tag = TAGS[level - 1] ?? "h2";
  return (
    <div>
      <Tag className={cn("font-semibold tracking-tight text-text", SIZE_CLASSES[level - 1] ?? "text-xl")}>{resolved}</Tag>
      {subtitle && <p className="mt-1 text-sm text-text-muted">{interpolate(subtitle, { user, tenant })}</p>}
    </div>
  );
}
