import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { NavItem } from "@antigravity/manifest-schema";
import { Breadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("renders nothing for a path of length <= 1", () => {
    const { container } = render(<Breadcrumbs path={[{ id: "a", label: "Dashboard", pageId: "page.dashboard" }]} onNavigate={() => {}} />);
    expect(container).toBeEmptyDOMElement();

    const { container: containerEmpty } = render(<Breadcrumbs path={[]} onNavigate={() => {}} />);
    expect(containerEmpty).toBeEmptyDOMElement();
  });

  it("renders each segment, with the last one as plain text (not a button)", () => {
    const path: NavItem[] = [
      { id: "hr", label: "HR" },
      { id: "employees", label: "Employees", pageId: "page.team" },
    ];
    render(<Breadcrumbs path={path} onNavigate={() => {}} />);
    expect(screen.getByText("HR")).toBeInTheDocument();
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Employees" })).not.toBeInTheDocument();
  });

  it("a mid-path segment with a pageId is a clickable button calling onNavigate with that id", () => {
    const onNavigate = vi.fn();
    const path: NavItem[] = [
      { id: "patients", label: "Patients", pageId: "page.patients" },
      { id: "detail", label: "Jane Doe" },
    ];
    render(<Breadcrumbs path={path} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Patients" }));
    expect(onNavigate).toHaveBeenCalledWith("page.patients");
  });

  it("a mid-path pure-group segment (no pageId) is plain text even though not last", () => {
    const path: NavItem[] = [
      { id: "hr", label: "HR" },
      { id: "employees", label: "Employees", pageId: "page.team" },
    ];
    render(<Breadcrumbs path={path} onNavigate={() => {}} />);
    expect(screen.queryByRole("button", { name: "HR" })).not.toBeInTheDocument();
  });
});
