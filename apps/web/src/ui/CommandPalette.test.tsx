import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette, type CommandItem } from "./CommandPalette";

const items: CommandItem[] = [
  { id: "dashboard", label: "Dashboard", onSelect: vi.fn() },
  { id: "tasks", label: "Tasks", onSelect: vi.fn() },
];

describe("CommandPalette", () => {
  it("renders nothing when open is false", () => {
    render(<CommandPalette items={items} open={false} onClose={() => {}} />);
    expect(screen.queryByPlaceholderText("Jump to…")).not.toBeInTheDocument();
  });

  it("renders the search input and every item when open", () => {
    render(<CommandPalette items={items} open onClose={() => {}} />);
    expect(screen.getByPlaceholderText("Jump to…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tasks/ })).toBeInTheDocument();
  });

  it("filters items as the query changes", () => {
    render(<CommandPalette items={items} open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Jump to…"), { target: { value: "task" } });
    expect(screen.queryByRole("button", { name: /Dashboard/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tasks/ })).toBeInTheDocument();
  });

  it("clicking an item calls its own onSelect and the passed onClose", () => {
    const onClose = vi.fn();
    const localItems: CommandItem[] = [{ id: "dashboard", label: "Dashboard", onSelect: vi.fn() }];
    render(<CommandPalette items={localItems} open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Dashboard/ }));
    expect(localItems[0]!.onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items} open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("a backdrop click calls onClose, a click inside the panel does not", () => {
    const onClose = vi.fn();
    render(<CommandPalette items={items} open onClose={onClose} />);
    fireEvent.click(screen.getByPlaceholderText("Jump to…"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByPlaceholderText("Jump to…").closest(".fixed")!);
    expect(onClose).toHaveBeenCalled();
  });
});
