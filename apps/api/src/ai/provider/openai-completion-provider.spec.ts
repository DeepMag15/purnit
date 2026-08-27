const mockOpenAiCreate = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockOpenAiCreate } } })),
}));

import { OpenAiCompletionProvider } from "./openai-completion-provider";
import type { CompletionRequest } from "./completion-provider";

function baseRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return { systemPrompt: "You are helpful.", messages: [{ role: "user", content: "hi" }], maxTokens: 100, ...overrides };
}

describe("OpenAiCompletionProvider", () => {
  beforeEach(() => mockOpenAiCreate.mockReset());

  it("sends no tools param when none are requested — today's behavior, byte-for-byte", async () => {
    mockOpenAiCreate.mockResolvedValue({
      choices: [{ message: { content: "Hello!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    const result = await provider.complete(baseRequest());

    expect(mockOpenAiCreate.mock.calls[0]![0].tools).toBeUndefined();
    expect(mockOpenAiCreate.mock.calls[0]![0].max_completion_tokens).toBe(100);
    expect(result).toEqual({ content: "Hello!", toolCall: undefined, stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 2 } });
  });

  it("maps tool declarations to OpenAI's {type:'function', function:{...}} shape", async () => {
    mockOpenAiCreate.mockResolvedValue({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    await provider.complete(
      baseRequest({ tools: [{ name: "task.create", description: "Create a task.", inputSchema: { type: "object", properties: { title: { type: "string" } } } }] }),
    );

    expect(mockOpenAiCreate.mock.calls[0]![0].tools).toEqual([
      { type: "function", function: { name: "task.create", description: "Create a task.", parameters: { type: "object", properties: { title: { type: "string" } } } } },
    ]);
  });

  it("extracts a function tool call, JSON.parse()-ing its string arguments, and maps finish_reason 'tool_calls' to 'tool_use'", async () => {
    mockOpenAiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Sure, creating that now.",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "task.create", arguments: '{"title":"Buy milk"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    const result = await provider.complete(baseRequest());

    expect(result.content).toBe("Sure, creating that now.");
    expect(result.toolCall).toEqual({ name: "task.create", input: { title: "Buy milk" } });
    expect(result.stopReason).toBe("tool_use");
  });

  it("keeps only the first function tool call when the model proposes more than one — same v1 scope cut as the other adapters", async () => {
    mockOpenAiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "task.create", arguments: '{"title":"First"}' } },
              { id: "call_2", type: "function", function: { name: "leave.submit", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    const result = await provider.complete(baseRequest());

    expect(result.toolCall).toEqual({ name: "task.create", input: { title: "First" } });
  });

  it("skips a non-function ('custom') tool call and falls through to the next function one", async () => {
    mockOpenAiCreate.mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              { id: "call_1", type: "custom", custom: { name: "some_custom_tool", input: "raw" } },
              { id: "call_2", type: "function", function: { name: "task.create", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    const result = await provider.complete(baseRequest());

    expect(result.toolCall).toEqual({ name: "task.create", input: {} });
  });

  it("maps a 'tool' NormalizedMessage to a plain 'user' turn — no native OpenAI role reachable without a tool_call_id", async () => {
    mockOpenAiCreate.mockResolvedValue({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    await provider.complete(baseRequest({ messages: [{ role: "tool", content: "Tool executed." }] }));

    expect(mockOpenAiCreate.mock.calls[0]![0].messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Tool executed." },
    ]);
  });

  it.each([
    ["stop", "end_turn"],
    ["length", "max_tokens"],
    ["tool_calls", "tool_use"],
    ["content_filter", "refused"],
    ["function_call", "error"],
  ])("maps finish_reason %s to stopReason %s", async (finishReason, expected) => {
    mockOpenAiCreate.mockResolvedValue({ choices: [{ message: {}, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const provider = new OpenAiCompletionProvider("key", "gpt-x");
    const result = await provider.complete(baseRequest());
    expect(result.stopReason).toBe(expected);
  });
});
