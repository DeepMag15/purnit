import { z } from "zod";
import type { CommonRenderProps } from "../registry";

export const PageSchema = z.object({});
type Props = z.infer<typeof PageSchema>;

export function Page({ childNodes, renderChild }: Props & CommonRenderProps) {
  return <div className="flex flex-col gap-6">{childNodes?.map(renderChild)}</div>;
}
