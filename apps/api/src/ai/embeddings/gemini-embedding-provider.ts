import { GoogleGenAI } from "@google/genai";
import type { EmbeddingProvider, EmbedRequest, EmbedResult } from "./embedding-provider";

/** gemini-embedding-001's real output size, used untruncated — see
 * embedding-provider.service.ts for why (Matryoshka truncation to
 * 768/1536 requires manual re-normalization to unit length to stay
 * correct; the full output avoids that risk entirely). */
export const GEMINI_EMBEDDING_DIMENSIONS = 3072;

function mapTaskType(taskType: EmbedRequest["taskType"]): string {
  return taskType === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const response = await this.client.models.embedContent({
      model: this.model,
      contents: req.texts,
      config: { taskType: mapTaskType(req.taskType) },
    });

    const vectors = response.embeddings?.map((e) => e.values ?? []) ?? [];
    if (vectors.length !== req.texts.length) {
      throw new Error(`Embedding provider returned ${vectors.length} vectors for ${req.texts.length} inputs`);
    }
    return { vectors };
  }
}
