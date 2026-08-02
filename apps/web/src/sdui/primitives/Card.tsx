import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { Card as UiCard, CardHeader, CardBody } from "../../ui/Card";

export const CardSchema = z.object({ title: z.string().optional() });
type Props = z.infer<typeof CardSchema>;

export function Card({ title, childNodes, renderChild }: Props & CommonRenderProps) {
  return (
    <UiCard>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-2">{childNodes?.map(renderChild)}</CardBody>
    </UiCard>
  );
}
