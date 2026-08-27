import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkspaceManifest } from "@purnit/manifest-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KpiCard } from "./KpiCard";
import { RenderContextProvider } from "../render-context";

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x", digestOptOut: false };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

function renderKpiCard(extraProps: { tone?: "neutral" | "success" | "warning" | "danger" | "info" | "accent" } = {}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RenderContextProvider
        value={{
          user,
          tenant,
          callDataSource: async () => 42,
          callMutation: async () => ({}),
          navigate: () => {},
          refetchBootstrap: () => {},
          openAiPanel: () => {},
          openBlueprintModal: () => {},
          aiAvailable: false,
        }}
      >
        <KpiCard label="Active Projects" bind={{ const: 42 }} nodeId="test-kpi" renderChild={() => null} {...extraProps} />
      </RenderContextProvider>
    </QueryClientProvider>,
  );
}

// Visual Polish & Consistency Pass — additive `tone` prop, defaults to
// today's exact look when omitted.
describe("KpiCard tone accent", () => {
  it("renders no left-border accent class when tone is omitted", () => {
    renderKpiCard();
    const card = screen.getByText("Active Projects").closest("div.rounded-lg");
    expect(card?.className).not.toMatch(/border-l-/);
  });

  it("renders the matching left-border accent class when tone is passed", () => {
    renderKpiCard({ tone: "danger" });
    const card = screen.getByText("Active Projects").closest("div.rounded-lg");
    expect(card?.className).toMatch(/border-l-2/);
    expect(card?.className).toMatch(/border-l-danger/);
  });
});
