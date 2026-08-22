import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ActionSpec } from "@purnit/manifest-schema";
import { useActionDispatch } from "./use-action-dispatch";
import { RenderContextProvider } from "./render-context";

const user = { id: "u1", displayName: "Test User", roles: [], permissionsHash: "x", digestOptOut: false };
const tenant = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

function wrapper(
  openAiPanel: (preset?: string, context?: unknown) => void,
  openBlueprintModal: (pageId: string, variant: "modal" | "drawer") => void = () => {},
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RenderContextProvider
        value={{
          user,
          tenant,
          callDataSource: async () => ({}),
          callMutation: async () => ({}),
          navigate: () => {},
          refetchBootstrap: () => {},
          openAiPanel,
          aiAvailable: true,
          openBlueprintModal,
        }}
      >
        {children}
      </RenderContextProvider>
    );
  };
}

describe("useActionDispatch — aiPrompt", () => {
  it("calls openAiPanel with the preset and no context when the action has none", async () => {
    const openAiPanel = vi.fn();
    const { result } = renderHook(() => useActionDispatch(), { wrapper: wrapper(openAiPanel) });

    const action: ActionSpec = { kind: "aiPrompt", preset: "documents.summarize" };
    await result.current(action);

    expect(openAiPanel).toHaveBeenCalledWith("documents.summarize", undefined);
  });

  it("resolves a context BindExpr against the current row before calling openAiPanel", async () => {
    const openAiPanel = vi.fn();
    const { result } = renderHook(() => useActionDispatch(), { wrapper: wrapper(openAiPanel) });

    const action: ActionSpec = { kind: "aiPrompt", preset: "projects.risk-report", context: { ref: "row.id" } };
    await result.current(action, { id: "p1" });

    expect(openAiPanel).toHaveBeenCalledWith("projects.risk-report", "p1");
  });
});

describe("useActionDispatch — openModal/openDrawer", () => {
  it("dispatches openModal with variant 'modal'", async () => {
    const openBlueprintModal = vi.fn();
    const { result } = renderHook(() => useActionDispatch(), { wrapper: wrapper(vi.fn(), openBlueprintModal) });

    const action: ActionSpec = { kind: "openModal", page: "page.team-management" };
    await result.current(action);

    expect(openBlueprintModal).toHaveBeenCalledWith("page.team-management", "modal");
  });

  it("dispatches openDrawer with variant 'drawer'", async () => {
    const openBlueprintModal = vi.fn();
    const { result } = renderHook(() => useActionDispatch(), { wrapper: wrapper(vi.fn(), openBlueprintModal) });

    const action: ActionSpec = { kind: "openDrawer", page: "page.recruitment" };
    await result.current(action);

    expect(openBlueprintModal).toHaveBeenCalledWith("page.recruitment", "drawer");
  });

  it("does not call openBlueprintModal for a download action (no backend export mechanism exists yet)", async () => {
    const openBlueprintModal = vi.fn();
    const { result } = renderHook(() => useActionDispatch(), { wrapper: wrapper(vi.fn(), openBlueprintModal) });

    const action: ActionSpec = { kind: "download", export: "projects.csv" };
    await result.current(action);

    expect(openBlueprintModal).not.toHaveBeenCalled();
  });
});
