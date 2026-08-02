import { extractText, getDocumentProxy } from "unpdf";

/** Phase B extracts only these MIME types — everything else in Documents'
 * broader upload allowlist (docx/xlsx/pptx/images/zip) gets no EmbeddingJob
 * at all this phase. Deliberate scope cut, not a silent drop: each has its
 * own natural future extraction library, left for a later phase. */
export const EXTRACTABLE_MIME_TYPES = new Set(["text/plain", "text/csv", "application/pdf"]);

export function isExtractable(mimeType: string): boolean {
  return EXTRACTABLE_MIME_TYPES.has(mimeType);
}

/** Returns null (not an error) for unsupported types — callers must check
 * isExtractable() before enqueueing a job in the first place; this is a
 * second, defensive check inside the processor. */
export async function extractDocumentText(bytes: Uint8Array, mimeType: string): Promise<string | null> {
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    return Buffer.from(bytes).toString("utf-8");
  }
  if (mimeType === "application/pdf") {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  return null;
}
