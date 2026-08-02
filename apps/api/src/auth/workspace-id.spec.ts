import { slugify } from "./workspace-id";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Magar Limited")).toBe("magar-limited");
  });

  it("strips punctuation", () => {
    expect(slugify("Acme, Inc.")).toBe("acme-inc");
  });

  it("collapses repeated separators into one hyphen", () => {
    expect(slugify("A   B---C")).toBe("a-b-c");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  -Hello World-  ")).toBe("hello-world");
  });
});
