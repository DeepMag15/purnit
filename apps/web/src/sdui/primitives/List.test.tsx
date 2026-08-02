import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkspaceManifest } from "@antigravity/manifest-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { List } from "./List";
import { RenderContextProvider } from "../render-context";

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x" };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

function renderList(rows: { id: string; name: string }[]) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RenderContextProvider
        value={{
          user,
          tenant,
          callDataSource: async () => [],
          callMutation: async () => ({}),
          navigate: () => {},
          refetchBootstrap: () => {},
          openAiPanel: () => {},
          aiAvailable: false,
        }}
      >
        <List titleField="name" bind={{ const: rows }} nodeId="test-list" renderChild={() => null} />
      </RenderContextProvider>
    </QueryClientProvider>,
  );
}

describe("List virtualization (performance pass 2, CONTEXT.md §48)", () => {
  it("below the threshold: renders every row as a plain <ul>/<li> list, unchanged", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
    renderList(rows);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.getByText("Row 9")).toBeInTheDocument();
  });

  it("above the threshold: switches to react-window, rendering only a windowed subset, not all rows", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
    renderList(rows);
    // The first row must be present (react-window always renders the start
    // of the visible window)...
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    // ...but a row far past any reasonable viewport must NOT be in the DOM —
    // this is the actual point of virtualization: proving it isn't secretly
    // rendering all 200 rows.
    expect(screen.queryByText("Row 199")).not.toBeInTheDocument();
    const rendered = screen.getAllByRole("listitem");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
  });
});
