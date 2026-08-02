import { Injectable } from "@nestjs/common";
import { AnthropicCompletionProvider } from "./anthropic-completion-provider";
import { GeminiCompletionProvider } from "./gemini-completion-provider";
import type { CompletionProvider, CompletionRequest, CompletionResult } from "./completion-provider";

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-5",
  // gemini-2.5-flash was retired for new API keys (confirmed live, not
  // assumed — this exact error surfaced during Phase A's own live
  // verification). gemini-3.6-flash is the current GA default.
  gemini: "gemini-3.6-flash",
};

function selectedProviderKey(): string {
  return process.env.AI_COMPLETION_PROVIDER ?? "anthropic";
}

function configuredApiKey(providerKey: string): string | undefined {
  if (providerKey === "gemini") return process.env.GEMINI_API_KEY;
  if (providerKey === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return undefined;
}

/** The one injectable seam every AI-facing module talks to a model through.
 * Two adapters exist (Anthropic, Gemini) — selected via `AI_COMPLETION_PROVIDER`
 * (default `"anthropic"`), each needing its own API key env var. No
 * tenant-level provider override yet (`forTenant()`-style resolution is
 * deliberately deferred until per-tenant differentiation is actually
 * needed). Constructing this class never throws even with no key
 * configured — that would take down the entire API at boot for an
 * optional feature; the failure is deferred to first real use, where it's
 * a clear, addressable error rather than a silent no-op. */
@Injectable()
export class AiProviderService {
  private provider: CompletionProvider | null = null;

  /** Used by the manifest compiler's `aiAvailable` flag — a pure
   * environment-config check, no instantiation. */
  static isConfigured(): boolean {
    return Boolean(configuredApiKey(selectedProviderKey()));
  }

  private resolve(): CompletionProvider {
    if (this.provider) return this.provider;

    const providerKey = selectedProviderKey();
    const apiKey = configuredApiKey(providerKey);
    if (!apiKey) {
      throw new Error(`AI provider "${providerKey}" is not configured — set its API key env var to enable the AI Assistant.`);
    }
    const model = process.env.AI_COMPLETION_MODEL ?? DEFAULT_MODELS[providerKey];

    if (providerKey === "gemini") {
      this.provider = new GeminiCompletionProvider(apiKey, model!);
    } else if (providerKey === "anthropic") {
      this.provider = new AnthropicCompletionProvider(apiKey, model!);
    } else {
      throw new Error(`Unknown AI_COMPLETION_PROVIDER "${providerKey}" — expected "anthropic" or "gemini".`);
    }
    return this.provider;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return this.resolve().complete(req);
  }
}
