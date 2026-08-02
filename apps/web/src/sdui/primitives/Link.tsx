import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useActionDispatch } from "../use-action-dispatch";

export const LinkSchema = z.object({ label: z.string() });
type Props = z.infer<typeof LinkSchema>;

export function Link({ label, actions }: Props & CommonRenderProps) {
  const dispatch = useActionDispatch();
  const action = actions?.[0];

  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        if (action) void dispatch(action);
      }}
      className={"text-sm text-accent hover:underline" + (action ? " cursor-pointer" : " cursor-default opacity-60")}
    >
      {label}
    </a>
  );
}
