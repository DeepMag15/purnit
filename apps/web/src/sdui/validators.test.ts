import { describe, it, expect } from "vitest";
import { required, email, minLength } from "./validators";

describe("required", () => {
  const validate = required();
  it("rejects undefined, null, empty string, and whitespace-only", () => {
    expect(validate(undefined)).toBe("Required");
    expect(validate(null)).toBe("Required");
    expect(validate("")).toBe("Required");
    expect(validate("   ")).toBe("Required");
  });
  it("accepts a real value", () => {
    expect(validate("Jane")).toBeUndefined();
  });
  it("supports a custom message", () => {
    expect(required("Name is required")("")).toBe("Name is required");
  });
});

describe("email", () => {
  const validate = email();
  it("accepts a well-formed address", () => {
    expect(validate("jane@example.com")).toBeUndefined();
  });
  it("rejects a malformed address", () => {
    expect(validate("not-an-email")).toBe("Enter a valid email");
  });
  it("is a no-op on an empty string, deferring to required()", () => {
    expect(validate("")).toBeUndefined();
  });
  it("is a no-op on a non-string value", () => {
    expect(validate(undefined)).toBeUndefined();
  });
});

describe("minLength", () => {
  const validate = minLength(3);
  it("rejects a too-short string", () => {
    expect(validate("ab")).toBe("Must be at least 3 characters");
  });
  it("accepts a string at or above the minimum", () => {
    expect(validate("abc")).toBeUndefined();
    expect(validate("abcd")).toBeUndefined();
  });
  it("is a no-op on a non-string value", () => {
    expect(validate(undefined)).toBeUndefined();
  });
});
