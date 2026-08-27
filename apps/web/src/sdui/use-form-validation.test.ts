import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormValidation } from "./use-form-validation";

interface Fields {
  name: string;
  email: string;
}

describe("useFormValidation", () => {
  it("returns false and populates fieldErrors when a validator fails", () => {
    const { result } = renderHook(() =>
      useFormValidation<Fields>({
        name: (v) => (v.trim() ? undefined : "Required"),
      }),
    );
    let valid = true;
    act(() => {
      valid = result.current.validate({ name: "", email: "x@example.com" });
    });
    expect(valid).toBe(false);
    expect(result.current.fieldErrors).toEqual({ name: "Required" });
  });

  it("returns true and clears fieldErrors when every validator passes", () => {
    const { result } = renderHook(() =>
      useFormValidation<Fields>({
        name: (v) => (v.trim() ? undefined : "Required"),
      }),
    );
    act(() => {
      result.current.validate({ name: "", email: "" });
    });
    expect(result.current.fieldErrors).toEqual({ name: "Required" });

    let valid = false;
    act(() => {
      valid = result.current.validate({ name: "Jane", email: "" });
    });
    expect(valid).toBe(true);
    expect(result.current.fieldErrors).toEqual({});
  });

  it("never flags a field with no validator in the map", () => {
    const { result } = renderHook(() => useFormValidation<Fields>({}));
    let valid = false;
    act(() => {
      valid = result.current.validate({ name: "", email: "" });
    });
    expect(valid).toBe(true);
    expect(result.current.fieldErrors).toEqual({});
  });

  it("clearFieldError removes exactly one field's error, leaving others intact", () => {
    const { result } = renderHook(() =>
      useFormValidation<Fields>({
        name: () => "Bad name",
        email: () => "Bad email",
      }),
    );
    act(() => {
      result.current.validate({ name: "x", email: "y" });
    });
    expect(result.current.fieldErrors).toEqual({ name: "Bad name", email: "Bad email" });

    act(() => result.current.clearFieldError("name"));
    expect(result.current.fieldErrors).toEqual({ email: "Bad email" });
  });

  it("reset clears all field errors", () => {
    const { result } = renderHook(() => useFormValidation<Fields>({ name: () => "Bad" }));
    act(() => {
      result.current.validate({ name: "x", email: "y" });
    });
    expect(result.current.fieldErrors).toEqual({ name: "Bad" });

    act(() => result.current.reset());
    expect(result.current.fieldErrors).toEqual({});
  });
});
