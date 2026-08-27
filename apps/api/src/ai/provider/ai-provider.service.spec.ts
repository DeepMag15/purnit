const mockAnthropicComplete = jest.fn().mockResolvedValue({ content: "anthropic-ok" });
const mockGeminiComplete = jest.fn().mockResolvedValue({ content: "gemini-ok" });
const mockOpenAiComplete = jest.fn().mockResolvedValue({ content: "openai-ok" });

jest.mock("./anthropic-completion-provider", () => ({
  AnthropicCompletionProvider: jest.fn().mockImplementation(() => ({ complete: mockAnthropicComplete })),
}));
jest.mock("./gemini-completion-provider", () => ({
  GeminiCompletionProvider: jest.fn().mockImplementation(() => ({ complete: mockGeminiComplete })),
}));
jest.mock("./openai-completion-provider", () => ({
  OpenAiCompletionProvider: jest.fn().mockImplementation(() => ({ complete: mockOpenAiComplete })),
}));

import { HttpException } from "@nestjs/common";
import { AiProviderService } from "./ai-provider.service";
import { AnthropicCompletionProvider } from "./anthropic-completion-provider";
import { GeminiCompletionProvider } from "./gemini-completion-provider";
import { OpenAiCompletionProvider } from "./openai-completion-provider";

const ORIGINAL_ENV = process.env;

describe("AiProviderService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("isConfigured", () => {
    it("is true when the global default provider's key is set", () => {
      process.env.AI_COMPLETION_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "k";
      expect(AiProviderService.isConfigured()).toBe(true);
    });

    it("is false when the global default provider's key is missing", () => {
      process.env.AI_COMPLETION_PROVIDER = "openai";
      delete process.env.OPENAI_API_KEY;
      expect(AiProviderService.isConfigured()).toBe(false);
    });
  });

  describe("configuredProviderKeys", () => {
    it("returns only the keys whose API key env var is actually set", () => {
      process.env.ANTHROPIC_API_KEY = "a";
      delete process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = "o";
      expect(AiProviderService.configuredProviderKeys()).toEqual(["anthropic", "openai"]);
    });
  });

  describe("complete", () => {
    it("uses the global default provider when no override is passed", async () => {
      process.env.AI_COMPLETION_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "k";
      const service = new AiProviderService();

      const result = await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 });

      expect(result).toEqual({ content: "gemini-ok" });
      expect(GeminiCompletionProvider).toHaveBeenCalledTimes(1);
    });

    it("uses the override provider instead of the global default when passed", async () => {
      process.env.AI_COMPLETION_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "a";
      process.env.OPENAI_API_KEY = "o";
      const service = new AiProviderService();

      const result = await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 }, "openai");

      expect(result).toEqual({ content: "openai-ok" });
      expect(OpenAiCompletionProvider).toHaveBeenCalledTimes(1);
      expect(mockAnthropicComplete).not.toHaveBeenCalled();
    });

    it("caches by provider key — two calls to the same key reuse one instance, not a new one per call", async () => {
      process.env.AI_COMPLETION_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "a";
      const service = new AiProviderService();

      await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 });
      await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 });

      expect(AnthropicCompletionProvider).toHaveBeenCalledTimes(1);
      expect(mockAnthropicComplete).toHaveBeenCalledTimes(2);
    });

    it("caches two different provider keys as two separate instances", async () => {
      process.env.AI_COMPLETION_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "a";
      process.env.GEMINI_API_KEY = "g";
      const service = new AiProviderService();

      await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 }); // anthropic (default)
      await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 }, "gemini"); // override

      expect(AnthropicCompletionProvider).toHaveBeenCalledTimes(1);
      expect(GeminiCompletionProvider).toHaveBeenCalledTimes(1);
    });

    it("throws a clear error when the resolved provider's key is not configured", async () => {
      process.env.AI_COMPLETION_PROVIDER = "anthropic";
      delete process.env.OPENAI_API_KEY;
      const service = new AiProviderService();

      await expect(service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 }, "openai")).rejects.toThrow(
        'AI provider "openai" is not configured',
      );
    });

    // AI Assistant Phase F, regression — live-verification-only bug: a
    // plain Error here reaches the client as an opaque 500. Before Phase F
    // this path was unreachable via a real request (an unconfigured global
    // default also makes aiAvailable false, hiding the chat UI); a
    // per-tenant override can now diverge from the global default while
    // aiAvailable still reads true, making a clean, addressable status code
    // load-bearing for the first time.
    it("throws an HttpException with status 503, not a plain Error, so the client gets a clean {statusCode, message} response", async () => {
      process.env.AI_COMPLETION_PROVIDER = "anthropic";
      delete process.env.OPENAI_API_KEY;
      const service = new AiProviderService();

      try {
        await service.complete({ systemPrompt: "s", messages: [], maxTokens: 10 }, "openai");
        throw new Error("expected complete() to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(503);
      }
    });
  });
});
