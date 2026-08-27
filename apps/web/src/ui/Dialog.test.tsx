import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test Dialog">
        <button>First</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on backdrop click but not on a click inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Test Dialog">
        <button>First</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalled();
  });

  it("wraps Tab from the last focusable element to the first, and Shift+Tab from the first to the last", () => {
    render(
      <Dialog open onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </Dialog>,
    );

    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}}>
        <button>First</button>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Regression test: every real caller (ProjectBoard, TaskList,
  // StudentsWorkspace, ...) passes onClose as an inline arrow function
  // (`onClose={() => setCreateOpen(false)}`), so its identity changes on
  // every parent render — and typing into a controlled field inside the
  // dialog re-renders the parent on every keystroke. If the focus-trap
  // effect depends on `onClose` itself (rather than reading it via a ref),
  // it re-runs on every keystroke and yanks focus away from the field
  // being typed into. This wrapper mirrors that exact real-world shape.
  it("does not steal focus away from a field while typing, even though the parent re-renders on every keystroke", () => {
    function CreateDialogHarness() {
      const [open, setOpen] = useState(true);
      const [name, setName] = useState("");
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="New Thing">
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </Dialog>
      );
    }
    render(<CreateDialogHarness />);
    const input = screen.getByLabelText("Name");
    input.focus();
    fireEvent.change(input, { target: { value: "H" } });
    fireEvent.change(input, { target: { value: "He" } });
    fireEvent.change(input, { target: { value: "Hel" } });
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("Hel");
  });
});
