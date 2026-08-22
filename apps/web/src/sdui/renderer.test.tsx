import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UINode, WorkspaceManifest } from "@purnit/manifest-schema";
import { Renderer } from "./renderer";
import { RenderContextProvider } from "./render-context";
import { registerAllComponents } from "./register-all";

beforeAll(() => {
  registerAllComponents();
});

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x", digestOptOut: false };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

function renderWithContext(node: UINode) {
  return render(
    <RenderContextProvider
      value={{
        user,
        tenant,
        callDataSource: async () => ({}),
        callMutation: async () => ({}),
        navigate: () => {},
        refetchBootstrap: () => {},
        openAiPanel: () => {},
        openBlueprintModal: () => {},
        aiAvailable: false,
      }}
    >
      <Renderer node={node} />
    </RenderContextProvider>,
  );
}

describe("Renderer resilience", () => {
  it("renders a broken node's own fallback, an unknown node's fallback, and leaves the rest of the page intact", () => {
    const page: UINode = {
      id: "page.test",
      type: "Page",
      version: 1,
      children: [
        { id: "heading", type: "Heading", version: 1, props: { text: "Hello, {{user.displayName}}" } },
        // Broken: KpiCard requires `label` (string) — omitted here.
        { id: "broken", type: "KpiCard", version: 1, props: {} },
        // Unknown: no such registered type@version.
        { id: "unknown", type: "TotallyMadeUp", version: 99, props: {} },
        { id: "trailing", type: "Text", version: 1, props: { text: "Still here" } },
      ],
    };

    renderWithContext(page);

    // Valid siblings on either side of the broken/unknown nodes rendered fine.
    expect(screen.getByText("Hello, Test User")).toBeInTheDocument();
    expect(screen.getByText("Still here")).toBeInTheDocument();

    // The broken node shows its own error fallback, not a crash.
    const errorFallback = screen.getByRole("alert");
    expect(errorFallback).toHaveAttribute("data-node-error", "broken");

    // The unknown node shows the graceful unknown-type fallback.
    const unknownFallback = screen.getByRole("note");
    expect(unknownFallback).toHaveAttribute("data-unknown-node", "unknown");
    expect(unknownFallback.textContent).toContain("TotallyMadeUp@99");
  });
});
