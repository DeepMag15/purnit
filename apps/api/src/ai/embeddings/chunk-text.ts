const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

/** Character-count based (no tokenizer dependency this phase). Prefers
 * breaking at the nearest paragraph/sentence boundary before a hard
 * cutoff, so a chunk doesn't split mid-sentence when avoidable. First-pass
 * sizing, not tuned against real retrieval data yet. */
export function chunkText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + CHUNK_SIZE, normalized.length);
    let end = hardEnd;

    if (hardEnd < normalized.length) {
      const window = normalized.slice(start, hardEnd);
      const paragraphBreak = window.lastIndexOf("\n\n");
      const sentenceBreak = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"));
      const breakPoint = paragraphBreak > CHUNK_SIZE / 2 ? paragraphBreak : sentenceBreak;
      if (breakPoint > CHUNK_SIZE / 2) {
        end = start + breakPoint + 1;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= normalized.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}
