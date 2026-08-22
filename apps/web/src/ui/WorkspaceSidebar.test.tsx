import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NavItem, WorkspaceManifest } from "@purnit/manifest-schema";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const manifest: WorkspaceManifest = {
  schemaVersion: 1,
  tenant: { id: "t1", name: "Test Co", workspaceId: "test-co", industry: "IT", branding: {}, profile: {} },
  user: { id: "u1", displayName: "Test User", roles: ["Admin"], permissionsHash: "x", digestOptOut: false },
  navigation: [],
  page: { id: "page.dashboard", type: "Page", version: 1 },
  featureFlags: {},
  aiAvailable: false,
  meta: { compiledAt: "", etag: "x" },
};

const items: NavItem[] = [
  { id: "nav.dashboard", label: "Dashboard", pageId: "page.dashboard" },
  {
    id: "nav.hr-group",
    label: "HR",
    children: [{ id: "nav.employees", label: "Employees", pageId: "page.team" }],
  },
];

describe("WorkspaceSidebar", () => {
  it("renders a leaf as a link and a pure group as a toggle with no href", () => {
    render(<WorkspaceSidebar items={items} manifest={manifest} pathname="/workspace" collapsed={false} onNavigate={() => {}} />);

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).toHaveAttribute("href", "/workspace");

    const groupToggle = screen.getByRole("button", { name: /HR/ });
    expect(groupToggle).not.toHaveAttribute("href");
  });

  it("keeps a group's children collapsed until toggled", () => {
    render(<WorkspaceSidebar items={items} manifest={manifest} pathname="/workspace" collapsed={false} onNavigate={() => {}} />);

    expect(screen.queryByText("Employees")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /HR/ }));
    expect(screen.getByText("Employees")).toBeInTheDocument();
  });

  it("auto-expands a group and highlights the active leaf at depth 2", () => {
    render(
      <WorkspaceSidebar items={items} manifest={manifest} pathname="/workspace/page.team" collapsed={false} onNavigate={() => {}} />,
    );

    const employeesLink = screen.getByRole("link", { name: "Employees" });
    expect(employeesLink).toBeInTheDocument();
    // Frontend Redesign, Phase 01 — active nav is a soft surface pop, not an
    // accent-tinted block (design review's own doctrine); see
    // WorkspaceSidebar.tsx's matching comment.
    expect(employeesLink).toHaveClass("bg-surface");

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).not.toHaveClass("bg-surface");
  });

  it("calls onNavigate when a leaf link is clicked", () => {
    let navigated = false;
    render(
      <WorkspaceSidebar
        items={items}
        manifest={manifest}
        pathname="/workspace"
        collapsed={false}
        onNavigate={() => {
          navigated = true;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(navigated).toBe(true);
  });

  it("wraps a row in a styled Tooltip (not the native title attribute) when collapsed", () => {
    render(<WorkspaceSidebar items={items} manifest={manifest} pathname="/workspace" collapsed onNavigate={() => {}} />);

    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).not.toHaveAttribute("title");
    const describedBy = dashboardLink.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Dashboard");
  });
});
