import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("renders both initials for a two-word name", () => {
    render(<Avatar name="Alice Johnson" />);
    expect(screen.getByText("AJ")).toBeInTheDocument();
  });

  it("uses the first two characters for a single-word name", () => {
    render(<Avatar name="Cher" />);
    expect(screen.getByText("CH")).toBeInTheDocument();
  });

  it("uses the first and last word's initials for a name with more than two words", () => {
    render(<Avatar name="Mary Jane Watson" />);
    expect(screen.getByText("MW")).toBeInTheDocument();
  });

  it("falls back to a question mark for an empty/whitespace-only name", () => {
    render(<Avatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("sets the full name as a title attribute for accessibility", () => {
    render(<Avatar name="Alice Johnson" />);
    expect(screen.getByTitle("Alice Johnson")).toBeInTheDocument();
  });
});
