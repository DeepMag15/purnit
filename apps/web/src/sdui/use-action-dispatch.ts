"use client";

import type { ActionSpec, BindExpr } from "@purnit/manifest-schema";
import { useRenderContext } from "./render-context";
import { getByPath } from "./interpolate";

function resolveInput(input: BindExpr | undefined, context: Record<string, unknown>): unknown {
  if (!input) return undefined;
  return "const" in input ? input.const : getByPath(context, input.ref);
}

/**
 * Dispatches an ActionSpec. `navigate`, `mutation`, `aiPrompt`, `openModal`,
 * and `openDrawer` are implemented. `download` remains a deliberate no-op:
 * unlike the other four, there's no existing backend "export" concept for
 * `action.export` to resolve against (confirmed — no data source/mutation
 * anywhere in this codebase produces a file export today), so implementing
 * it would mean inventing new backend surface rather than wiring up
 * something that already exists.
 */
export function useActionDispatch() {
  const { navigate, callMutation, openAiPanel, openBlueprintModal, user, tenant } = useRenderContext();

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
      case "openModal":
        openBlueprintModal(action.page, "modal");
        return;
      case "openDrawer":
        openBlueprintModal(action.page, "drawer");
        return;
      case "download":
        console.warn(`[SDUI] action kind "download" has no backend export mechanism to call yet (export: "${action.export}")`);
        return;
      default:
        console.warn(`[SDUI] unrecognized action kind`, action);
    }
  };
}
