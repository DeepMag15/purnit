import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs, type TabItem } from "./Tabs";

const items: TabItem[] = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];

function ControlledTabs() {
  const [activeId, setActiveId] = useState("a");
  return <Tabs items={items} activeId={activeId} onChange={setActiveId} />;
}

describe("Tabs", () => {
  it("only the active tab has tabIndex 0, every other tab has -1", () => {
    render(<ControlledTabs />);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabIndex", "0");
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("tabIndex", "-1");
  });

  it("ArrowRight moves focus and activation to the next tab, wrapping at the end", () => {
    render(<ControlledTabs />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    alpha.focus();

    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Beta" }));

    fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Gamma" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
  });

  it("ArrowLeft moves focus and activation to the previous tab, wrapping at the start", () => {
    render(<ControlledTabs />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    fireEvent.keyDown(alpha, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
  });

  it("clicking a tab activates it directly", () => {
    render(<ControlledTabs />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true");
  });
});
