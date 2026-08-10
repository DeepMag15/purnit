import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { Badge as UiBadge } from "../../ui/Badge";

export const BadgeSchema = z.object({
  text: z.string(),
  tone: z.enum(["neutral", "success", "warning", "danger", "info", "accent"]).optional(),
});
type Props = z.infer<typeof BadgeSchema>;

export function Badge({ text, tone = "neutral" }: Props & CommonRenderProps) {
  return <UiBadge tone={tone}>{text}</UiBadge>;
}
