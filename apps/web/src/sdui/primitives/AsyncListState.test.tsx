import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsyncListState } from "./AsyncListState";

describe("AsyncListState", () => {
  it("renders a loading skeleton when loading, regardless of other props", () => {
    render(
      <AsyncListState loading error="boom" isEmpty>
        <div>content</div>
      </AsyncListState>,
    );
    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("renders an error Alert with the loadErrorLabel when error is set (and not loading)", () => {
    render(
      <AsyncListState loading={false} error="network down" isEmpty={false} loadErrorLabel="patients">
        <div>content</div>
      </AsyncListState>,
    );
    expect(screen.getByText(/Couldn't load patients: network down/)).toBeInTheDocument();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders the empty state when isEmpty and no error", () => {
    render(
      <AsyncListState loading={false} error={null} isEmpty emptyMessage="No patients yet.">
        <div>content</div>
      </AsyncListState>,
    );
    expect(screen.getByText("No patients yet.")).toBeInTheDocument();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders children when not loading, no error, and not empty", () => {
    render(
      <AsyncListState loading={false} error={null} isEmpty={false}>
        <div>content</div>
      </AsyncListState>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
