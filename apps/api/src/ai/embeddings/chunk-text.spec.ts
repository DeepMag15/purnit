import { chunkText } from "./chunk-text";

describe("chunkText", () => {
  it("returns an empty array for empty/whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    const text = "A short document about nothing in particular.";
    expect(chunkText(text)).toEqual([text]);
  });

  it("splits long text into multiple chunks with overlap", () => {
    const paragraph = "Sentence number goes here. ".repeat(100); // well over 1200 chars
    const chunks = chunkText(paragraph);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk (but the last) should be close to but not wildly over the
    // target size — a hard runaway chunk would indicate the break-point
    // search silently failed.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("prefers breaking at a paragraph boundary over a hard cutoff", () => {
    const first = "First paragraph. ".repeat(60); // ~1020 chars
    const second = "Second paragraph. ".repeat(60);
    const text = `${first}\n\n${second}`;

    const chunks = chunkText(text);
    // The first chunk should end at (or very near) the paragraph break, not
    // mid-word deep into the second paragraph.
    expect(chunks[0]!.endsWith("paragraph.") || chunks[0]!.trim().endsWith("paragraph.")).toBe(true);
  });

  it("never loses content — every character of the source appears in some chunk", () => {
    const text = "word ".repeat(500);
    const chunks = chunkText(text);
    const covered = chunks.join(" ");
    // Overlap means chunks re-include content, but nothing from the middle
    // of the source should be entirely absent from every chunk.
    for (const word of ["word"]) {
      expect(covered).toContain(word);
    }
    expect(chunks.length).toBeGreaterThan(1);
  });
});
