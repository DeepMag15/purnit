import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useActionDispatch } from "../use-action-dispatch";
import { Button as UiButton } from "../../ui/Button";

export const ButtonSchema = z.object({
  label: z.string(),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
});
type Props = z.infer<typeof ButtonSchema>;

export function Button({ label, variant = "primary", actions }: Props & CommonRenderProps) {
  const dispatch = useActionDispatch();
  const action = actions?.[0];

  return (
    <UiButton variant={variant} disabled={!action} onClick={action ? () => dispatch(action) : undefined}>
      {label}
    </UiButton>
  );
}
