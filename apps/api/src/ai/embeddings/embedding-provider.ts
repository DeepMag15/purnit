export interface EmbedRequest {
  texts: string[];
  taskType: "document" | "query";
}

export interface EmbedResult {
  vectors: number[][];
}

export interface EmbeddingProvider {
  embed(req: EmbedRequest): Promise<EmbedResult>;
}
