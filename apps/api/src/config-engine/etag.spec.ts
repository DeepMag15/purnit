import { etagMatches } from "./etag";

describe("etagMatches", () => {
  it("matches the quoted form we actually emit", () => {
    expect(etagMatches('"abc123"', "abc123")).toBe(true);
  });

  it("matches an unquoted value too (lenient)", () => {
    expect(etagMatches("abc123", "abc123")).toBe(true);
  });

  it("does not match a different etag", () => {
    expect(etagMatches('"abc123"', "def456")).toBe(false);
  });

  it("returns false when the header is absent", () => {
    expect(etagMatches(undefined, "abc123")).toBe(false);
  });

  it("matches any candidate in a comma-separated list", () => {
    expect(etagMatches('"xxx", "abc123", "yyy"', "abc123")).toBe(true);
  });

  it("returns false when no candidate in the list matches", () => {
    expect(etagMatches('"xxx", "yyy"', "abc123")).toBe(false);
  });
});
