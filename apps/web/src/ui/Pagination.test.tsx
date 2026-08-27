import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("renders nothing when totalPages <= 1", () => {
    const { container } = render(<Pagination page={0} totalPages={1} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Prev on the first page and Next on the last page", () => {
    render(<Pagination page={0} totalPages={3} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  it("calls onChange with the clamped next/prev page", () => {
    const onChange = vi.fn();
    render(<Pagination page={1} totalPages={3} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onChange).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("shows the current page label", () => {
    render(<Pagination page={1} totalPages={4} onChange={() => {}} />);
    expect(screen.getByText("Page 2 of 4")).toBeInTheDocument();
  });
});
