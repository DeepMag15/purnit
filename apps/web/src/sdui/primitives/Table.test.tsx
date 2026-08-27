import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WorkspaceManifest } from "@purnit/manifest-schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Table3 } from "./Table";
import { RenderContextProvider } from "../render-context";

const user: WorkspaceManifest["user"] = { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x", digestOptOut: false };
const tenant: WorkspaceManifest["tenant"] = { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} };

const ROWS = [
  { id: "1", name: "Alpha", status: "active" },
  { id: "2", name: "Beta", status: "done" },
];

function renderTable(props: { onRowClick?: (row: Record<string, unknown>) => void; actions?: { kind: "navigate"; to: string }[] } = {}) {
  const navigate = vi.fn();
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <RenderContextProvider
        value={{
          user,
          tenant,
          callDataSource: async () => [],
          callMutation: async () => ({}),
          navigate,
          refetchBootstrap: () => {},
          openAiPanel: () => {},
          openBlueprintModal: () => {},
          aiAvailable: false,
        }}
      >
        <Table3 columns={["name", "status"]} pageSize={20} bind={{ const: ROWS }} nodeId="test-table" renderChild={() => null} {...props} />
      </RenderContextProvider>
    </QueryClientProvider>,
  );
  return { navigate };
}

// Frontend Structural Redesign, Phase 0 — Table3's new onRowClick prop.
describe("Table3 onRowClick (Phase 0)", () => {
  it("rows are not clickable when neither onRowClick nor a navigate action is given", () => {
    renderTable();
    const row = screen.getByText("Alpha").closest("tr")!;
    expect(row.className).not.toContain("cursor-pointer");
  });

  it("clicking a row calls onRowClick with that row's data", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    fireEvent.click(screen.getByText("Alpha"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: "1", name: "Alpha" }));
  });

  it("falls back to dispatching the existing navigate action when onRowClick is absent", () => {
    const { navigate } = renderTable({ actions: [{ kind: "navigate", to: "page.projects" }] });
    fireEvent.click(screen.getByText("Alpha"));
    expect(navigate).toHaveBeenCalledWith("page.projects");
  });

  it("onRowClick takes precedence over a navigate action when both are given", () => {
    const onRowClick = vi.fn();
    const { navigate } = renderTable({ onRowClick, actions: [{ kind: "navigate", to: "page.projects" }] });
    fireEvent.click(screen.getByText("Alpha"));
    expect(onRowClick).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
