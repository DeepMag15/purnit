import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AnthropicCompletionProvider } from "./anthropic-completion-provider";
import { GeminiCompletionProvider } from "./gemini-completion-provider";
import { OpenAiCompletionProvider } from "./openai-completion-provider";
import type { CompletionProvider, CompletionRequest, CompletionResult } from "./completion-provider";

const PROVIDER_KEYS = ["anthropic", "gemini", "openai"] as const;

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-5",
  // gemini-2.5-flash was retired for new API keys (confirmed live, not
  // assumed — this exact error surfaced during Phase A's own live
  // verification). gemini-3.6-flash is the current GA default.
  gemini: "gemini-3.6-flash",
  // ⚠️ Unconfirmed (AI Assistant Phase F) — no OPENAI_API_KEY exists in this
  // project, so this could not be checked against a live call or a current
  // model listing, only picked as a reasonable placeholder. Verify before
  // trusting, same caution `gemini-2.5-flash`'s own retirement earned.
  openai: "gpt-5.1",
};

/** Exported for callers that need to RECORD which provider ran, not to pick
 * one — duplicating this env-var logic elsewhere would drift. */
export function selectedProviderKey(): string {
  return process.env.AI_COMPLETION_PROVIDER ?? "anthropic";
}

function configuredApiKey(providerKey: string): string | undefined {
  if (providerKey === "gemini") return process.env.GEMINI_API_KEY;
  if (providerKey === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (providerKey === "openai") return process.env.OPENAI_API_KEY;
  return undefined;
}

/** The one injectable seam every AI-facing module talks to a model through.
 * Three adapters exist (Anthropic, Gemini, OpenAI) — selected via
 * `AI_COMPLETION_PROVIDER` (default `"anthropic"`), each needing its own API
 * key env var. `complete()`'s optional `providerKeyOverride` (AI Assistant
 * Phase F) lets a caller resolve a specific tenant's own provider choice
 * (read via `resolveTenantProviderOverride`) instead of the global default —
 * see `resolve-tenant-provider.ts`. Constructing this class never throws
 * even with no key configured — that would take down the entire API at boot
 * for an optional feature; the failure is deferred to first real use, where
 * it's a clear, addressable error rather than a silent no-op. */
@Injectable()
export class AiProviderService {
  // Keyed by resolved provider key, not by tenant — only 3 possible values
  // ever exist, so many tenants sharing a provider correctly share one
  // instantiated SDK client instead of paying for a redundant one per
  // tenant. The *choice* of key is resolved fresh per call by the caller
  // (see `complete()`'s `providerKeyOverride`), never cached here.
  private readonly providers = new Map<string, CompletionProvider>();

  /** Used by the manifest compiler's `aiAvailable` flag — a pure,
   * global-env-only check, no instantiation, no tenant context. If a tenant
   * overrides to a provider whose key isn't globally set, this still reads
   * `true` off the global default's key; the real failure surfaces at first
   * actual use via `resolve()`'s own clear error below — a disclosed,
   * accepted trade-off, not a regression (this service has never thrown at
   * boot for an unconfigured optional feature). */
  static isConfigured(): boolean {
    return Boolean(configuredApiKey(selectedProviderKey()));
  }

  /** Which of the 3 provider keys have their API key actually set in this
   * environment — lets a Settings UI grey out an unusable override choice
   * rather than letting an Admin pick one that will only fail later. */
  static configuredProviderKeys(): string[] {
    return PROVIDER_KEYS.filter((key) => Boolean(configuredApiKey(key)));
  }

  private resolve(providerKeyOverride?: string): CompletionProvider {
    const providerKey = providerKeyOverride ?? selectedProviderKey();
    const cached = this.providers.get(providerKey);
    if (cached) return cached;

    const apiKey = configuredApiKey(providerKey);
    if (!apiKey) {
      // A plain Error here reaches the client as an opaque 500 — confirmed
      // live during AI Assistant Phase F's own verification (this exact
      // scenario was unreachable pre-Phase-F, since an unconfigured *global*
      // default also makes `isConfigured()`/`aiAvailable` false, hiding the
      // chat UI entirely; a per-tenant override can now diverge from the
      // global default while `aiAvailable` still reads true, making this a
      // real, live-reachable path for the first time). `HttpException`
      // subclasses are what NestJS's built-in filter formats into a clean
      // `{statusCode, message}` response — a plain `Error` isn't.
      throw new ServiceUnavailableException(`AI provider "${providerKey}" is not configured — set its API key env var to enable the AI Assistant.`);
    }
    const model = process.env.AI_COMPLETION_MODEL ?? DEFAULT_MODELS[providerKey];

    let instance: CompletionProvider;
    if (providerKey === "gemini") {
      instance = new GeminiCompletionProvider(apiKey, model!);
    } else if (providerKey === "anthropic") {
      instance = new AnthropicCompletionProvider(apiKey, model!);
    } else if (providerKey === "openai") {
      instance = new OpenAiCompletionProvider(apiKey, model!);
    } else {
      throw new ServiceUnavailableException(`Unknown AI provider "${providerKey}" — expected "anthropic", "gemini", or "openai".`);
    }
    this.providers.set(providerKey, instance);
    return instance;
  }

  async complete(req: CompletionRequest, providerKeyOverride?: string): Promise<CompletionResult> {
    return this.resolve(providerKeyOverride).complete(req);
  }
}
