import { z } from "zod";
import type { CommonRenderProps } from "../registry";
import { useActionDispatch } from "../use-action-dispatch";
import { Dropdown, DropdownItem } from "../../ui/Dropdown";
import { Icon } from "../../ui/Icon";

export const ActionMenuSchema = z.object({ label: z.string().optional() });
type Props = z.infer<typeof ActionMenuSchema>;

export function ActionMenu({ label = "Actions", actions }: Props & CommonRenderProps) {
  const dispatch = useActionDispatch();

  if (!actions || actions.length === 0) return null;

  return (
    <Dropdown
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors duration-150 hover:bg-surface-hover"
        >
          {label}
          <Icon name="expand_more" size={13} />
        </button>
      )}
    >
      {({ close }) =>
        actions.map((action, i) => (
          <DropdownItem
            key={i}
            onClick={() => {
              close();
              void dispatch(action);
            }}
          >
            {"mutation" in action ? action.mutation : action.kind}
          </DropdownItem>
        ))
      }
    </Dropdown>
  );
}
