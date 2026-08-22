import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show("Saved successfully")}>
      Fire toast
    </button>
  );
}

// Phase 06 — Toast's own two-step removal (mark `leaving`, unmount only
// after the exit animation's own duration) replaced an instant filter() on
// both the 3500ms auto-expiry and the manual close-button path. These tests
// lock in that timing so the exit animation always has time to actually run.
describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast immediately with the enter animation class", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fire toast" }));
    const toastEl = screen.getByText("Saved successfully").closest("div")!;
    expect(toastEl).toHaveClass("toast-enter");
    expect(toastEl).not.toHaveClass("toast-exit");
  });

  it("auto-expiry after 3500ms marks it leaving (exit class) before removing it, not an instant unmount", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fire toast" }));

    act(() => {
      vi.advanceTimersByTime(3500);
    });
    const toastEl = screen.getByText("Saved successfully").closest("div")!;
    expect(toastEl).toHaveClass("toast-exit");

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
  });

  it("clicking the close button marks it leaving immediately, then removes it after the exit duration", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fire toast" }));

    const toastEl = screen.getByText("Saved successfully").closest("div")!;
    fireEvent.click(within(toastEl).getByRole("button"));
    expect(toastEl).toHaveClass("toast-exit");
    expect(screen.getByText("Saved successfully")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByText("Saved successfully")).not.toBeInTheDocument();
  });
});
