export interface NormalizedMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

/** An AI-tool declaration offered to the model — built by
 * build-tool-declarations.ts from an allowlisted MutationDefinition's own
 * Zod inputSchema via zod's native z.toJSONSchema(). */
export interface ToolDeclaration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  systemPrompt: string;
  messages: NormalizedMessage[];
  maxTokens: number;
  /** Omitted/empty means no tool-calling — today's behavior, byte-for-byte,
   * for every existing caller. */
  tools?: ToolDeclaration[];
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A tool call the model proposed. Raw, unvalidated args exactly as the
 * provider returned them — callers MUST re-validate via
 * MutationRegistry.get(name).inputSchema before trusting this, never
 * assumed safe just because the tool was offered. */
export interface ProposedToolCall {
  name: string;
  input: unknown;
}

export interface CompletionResult {
  content: string;
  /** v1 scope cut (Phase D): at most one, even if the provider proposed
   * several in one turn — the first is kept, the rest silently discarded. */
  toolCall?: ProposedToolCall;
  stopReason: "end_turn" | "max_tokens" | "refused" | "error" | "tool_use";
  usage: CompletionUsage;
}

/** The one seam every module talks to a model through — no module ever
 * imports a vendor SDK directly. Two adapters exist (Anthropic, Gemini);
 * Phase D added `tools`/`toolCall` support to both — `stream` remains
 * deliberately absent until streaming is actually built, rather than
 * speculatively shaped in now. */
export interface CompletionProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}
