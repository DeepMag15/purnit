import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkspaceManifest } from "@purnit/manifest-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { List } from "./List";
import { RenderContextProvider } from "../render-context";

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x", digestOptOut: false };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

function renderList(rows: { id: string; name: string }[], extraProps: { title?: string; limit?: number } = {}) {
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
          openBlueprintModal: () => {},
          aiAvailable: false,
        }}
      >
        <List titleField="name" bind={{ const: rows }} nodeId="test-list" renderChild={() => null} {...extraProps} />
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

// Platform UI/UX Redesign, Phase F — additive title/limit props.
describe("List title/limit (Phase F)", () => {
  it("renders no heading when title is omitted", () => {
    const rows = [{ id: "1", name: "Row 1" }];
    renderList(rows);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders the given title as a heading", () => {
    const rows = [{ id: "1", name: "Row 1" }];
    renderList(rows, { title: "Recent Projects" });
    expect(screen.getByText("Recent Projects")).toBeInTheDocument();
  });

  it("caps the rendered rows at limit, even though bind returned more", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
    renderList(rows, { limit: 3 });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.getByText("Row 2")).toBeInTheDocument();
    expect(screen.queryByText("Row 3")).not.toBeInTheDocument();
  });

  it("renders every row when limit is omitted (unchanged default)", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
    renderList(rows);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });
});
