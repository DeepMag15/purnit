"use client";

import type { ActionSpec, BindExpr } from "@antigravity/manifest-schema";
import { useRenderContext } from "./render-context";
import { getByPath } from "./interpolate";

function resolveInput(input: BindExpr | undefined, context: Record<string, unknown>): unknown {
  if (!input) return undefined;
  return "const" in input ? input.const : getByPath(context, input.ref);
}

/**
 * Dispatches an ActionSpec. `navigate`, `mutation`, and `aiPrompt` are
 * implemented — `openModal`/`openDrawer`/`download` are logged and
 * otherwise no-op until a later stage needs them.
 */
export function useActionDispatch() {
  const { navigate, callMutation, openAiPanel, user, tenant } = useRenderContext();

  return async (action: ActionSpec, row?: unknown) => {
    const context = { user, tenant, row };
    switch (action.kind) {
      case "navigate":
        navigate(action.to);
        return;
      case "mutation":
        await callMutation(action.mutation, resolveInput(action.input, context));
        return;
      case "aiPrompt":
        openAiPanel(action.preset, resolveInput(action.context, context));
        return;
      default:
        console.warn(`[SDUI] action kind "${action.kind}" is not implemented yet`);
    }
  };
}
