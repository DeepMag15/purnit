import { Injectable } from "@nestjs/common";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider";
import type { EmbeddingProvider, EmbedRequest, EmbedResult } from "./embedding-provider";

// text-embedding-004 (a commonly-cited default) is already deprecated past
// its Jan 14, 2026 retirement — confirmed live during Phase B research, the
// same class of mistake Phase A already hit once with the completion model.
// No OPENAI_API_KEY exists in this project, so unlike the original
// architecture sketch (OpenAI default for embeddings), Gemini is the only
// embedding provider for now — reuses GEMINI_API_KEY, no new secret needed.
const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-embedding-001",
};

function selectedProviderKey(): string {
  return process.env.AI_EMBEDDING_PROVIDER ?? "gemini";
}

function configuredApiKey(providerKey: string): string | undefined {
  if (providerKey === "gemini") return process.env.GEMINI_API_KEY;
  return undefined;
}

/** Mirrors AiProviderService (apps/api/src/ai/provider/ai-provider.service.ts)
 * exactly — a separate provider seam from completion, since embedding and
 * completion are genuinely different capabilities a vendor may or may not
 * offer (Anthropic has no embeddings endpoint at all). Never throws at
 * construction; if unconfigured, RetrievalService treats that as "no
 * results" rather than a hard failure — basic chat must keep working even
 * if embeddings are misconfigured independently. */
@Injectable()
export class EmbeddingProviderService {
  private provider: EmbeddingProvider | null = null;

  static isConfigured(): boolean {
    return Boolean(configuredApiKey(selectedProviderKey()));
  }

  private resolve(): EmbeddingProvider {
    if (this.provider) return this.provider;

    const providerKey = selectedProviderKey();
    const apiKey = configuredApiKey(providerKey);
    if (!apiKey) {
      throw new Error(`Embedding provider "${providerKey}" is not configured — set its API key env var to enable AI retrieval.`);
    }
    const model = process.env.AI_EMBEDDING_MODEL ?? DEFAULT_MODELS[providerKey];

    if (providerKey === "gemini") {
      this.provider = new GeminiEmbeddingProvider(apiKey, model!);
    } else {
      throw new Error(`Unknown AI_EMBEDDING_PROVIDER "${providerKey}" — expected "gemini".`);
    }
    return this.provider;
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    return this.resolve().embed(req);
  }
}
