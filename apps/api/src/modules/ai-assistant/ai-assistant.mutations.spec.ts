import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { aiConversationCreateMutation, aiConversationArchiveMutation, createAiMessageSendMutation } from "./ai-assistant.mutations";
import type { PrismaTx, TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../../ai/provider/ai-provider.service";
import { EmbeddingProviderService } from "../../ai/embeddings/embedding-provider.service";
import type { RetrievalService } from "../../ai/retrieval/retrieval.service";
import type { PermissionResolverService } from "../../rbac/permission-resolver.service";
import type { MutationRegistry } from "../../mutations/mutation-registry.service";

function context(userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions([]) };
}

describe("aiConversation.create", () => {
  it("creates a conversation scoped to the caller's tenant+user", async () => {
    const tx = { aiConversation: { create: jest.fn().mockResolvedValue({ id: "c1" }) } } as unknown as PrismaTx;
    await aiConversationCreateMutation.resolve({}, context(), tx);
    expect((tx as unknown as { aiConversation: { create: jest.Mock } }).aiConversation.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", userId: "u1" },
    });
  });

  it("persists preset + contextRef when provided (Phase B's per-document entry points)", async () => {
    const tx = { aiConversation: { create: jest.fn().mockResolvedValue({ id: "c1" }) } } as unknown as PrismaTx;
    const contextRef = { sourceType: "document", sourceId: "doc-1" };
    await aiConversationCreateMutation.resolve({ preset: "documents.summarize", contextRef }, context(), tx);
    expect((tx as unknown as { aiConversation: { create: jest.Mock } }).aiConversation.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", userId: "u1", preset: "documents.summarize", contextRef },
    });
  });
});

describe("aiConversation.archive", () => {
  it("throws when the conversation isn't the caller's", async () => {
    const tx = { aiConversation: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(aiConversationArchiveMutation.resolve({ id: "c1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("sets archivedAt when owned", async () => {
    const tx = {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "c1", archivedAt: new Date() }),
      },
    } as unknown as PrismaTx;
    await aiConversationArchiveMutation.resolve({ id: "c1" }, context(), tx);
    expect((tx as unknown as { aiConversation: { update: jest.Mock } }).aiConversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { archivedAt: expect.any(Date) },
    });
  });
});

describe("aiMessage.send", () => {
  function fakeTenantPrisma(tx: unknown, tenant: { id: string; name: string } | null = { id: "t1", name: "Acme" }) {
    return {
      run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
      root: { tenant: { findUnique: jest.fn().mockResolvedValue(tenant) } },
    } as unknown as TenantPrismaService;
  }

  function fakeAiProvider(content = "Hello there!") {
    return { complete: jest.fn().mockResolvedValue({ content, stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } }) } as unknown as AiProviderService;
  }

  // Real EmbeddingProviderService.isConfigured() reads GEMINI_API_KEY from
  // process.env, which the test process never loads (only main.ts does, at
  // real app boot) — so it's always false here, and preResolve's retrieval
  // branch never runs. These fakes exist only to satisfy the factory's
  // signature; nothing in them is ever called.
  function fakeEmbeddingProvider() {
    return { embed: jest.fn() } as unknown as EmbeddingProviderService;
  }
  function fakeRetrievalService() {
    return { retrieve: jest.fn() } as unknown as RetrievalService;
  }
  function fakePermissionResolver() {
    return { resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions([])) } as unknown as PermissionResolverService;
  }

  // Phase D — `preResolve` now resolves `effective` unconditionally (needed
  // for tool declarations regardless of RAG config) and builds tool
  // declarations via a real MutationRegistry lookup. Empty by default (no
  // allowlisted mutation registered) so `buildToolDeclarations` returns `[]`
  // and every pre-existing test's behavior is unaffected; individual tests
  // override with a real definition where the tool-proposing path itself is
  // under test.
  function fakeMutationRegistry(defs: Record<string, unknown> = {}) {
    return { get: jest.fn((name: string) => defs[name]) } as unknown as MutationRegistry;
  }

  function buildMutation(
    aiProvider: AiProviderService,
    tx: unknown,
    tenant?: { id: string; name: string } | null,
    mutationRegistry: MutationRegistry = fakeMutationRegistry(),
  ) {
    return createAiMessageSendMutation(
      aiProvider,
      fakeTenantPrisma(tx, tenant),
      fakeEmbeddingProvider(),
      fakeRetrievalService(),
      fakePermissionResolver(),
      mutationRegistry,
    );
  }

  it("preResolve throws NotFoundException when no User row matches the auth session", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const mutation = buildMutation(fakeAiProvider(), tx);
    await expect(mutation.preResolve!({ conversationId: "c1", content: "hi" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(NotFoundException);
  });

  it("preResolve throws NotFoundException when the conversation isn't the resolved user's — before calling the provider", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const aiProvider = fakeAiProvider();
    const mutation = buildMutation(aiProvider, tx);
    await expect(mutation.preResolve!({ conversationId: "c1", content: "hi" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(NotFoundException);
    expect((aiProvider as unknown as { complete: jest.Mock }).complete).not.toHaveBeenCalled();
  });

  it("preResolve calls the provider with system prompt + history + new message, and flags isFirstMessage correctly", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
      // Mocked in the same order a real `orderBy: { createdAt: "desc" }`
      // query would return (newest first) — the implementation reverses
      // this to chronological order before building the prompt.
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([
          { role: "assistant", content: "earlier answer", createdAt: new Date("2026-01-02") },
          { role: "user", content: "earlier question", createdAt: new Date("2026-01-01") },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const aiProvider = fakeAiProvider("Here's my answer");
    const mutation = buildMutation(aiProvider, tx);

    const pre = await mutation.preResolve!({ conversationId: "c1", content: "new question" }, { tenantId: "t1", authUserId: "au1" });

    expect(pre).toMatchObject({ assistantContent: "Here's my answer", isFirstMessage: false, usage: { inputTokens: 10, outputTokens: 5 } });
    const call = (aiProvider as unknown as { complete: jest.Mock }).complete.mock.calls[0][0];
    expect(call.systemPrompt).toContain("Acme");
    expect(call.messages).toEqual([
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "new question" },
    ]);
  });

  it("preResolve flags isFirstMessage true when there's no prior history", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
      aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const mutation = buildMutation(fakeAiProvider(), tx);
    const pre = await mutation.preResolve!({ conversationId: "c1", content: "first ever message" }, { tenantId: "t1", authUserId: "au1" });
    expect(pre.isFirstMessage).toBe(true);
  });

  describe("tool-calling (Phase D)", () => {
    const taskCreateDef = { name: "task.create", inputSchema: z.object({ title: z.string().min(1) }), requiredPermission: "task:create" };

    it("preResolve passes tool declarations to the provider when an allowlisted mutation is registered and permitted", async () => {
      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
        aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const permissionResolver = { resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions(["task:create:tenant"])) } as unknown as PermissionResolverService;
      const aiProvider = fakeAiProvider("Sure, I can do that.");
      const mutation = createAiMessageSendMutation(
        aiProvider,
        fakeTenantPrisma(tx),
        fakeEmbeddingProvider(),
        fakeRetrievalService(),
        permissionResolver,
        fakeMutationRegistry({ "task.create": taskCreateDef }),
      );

      await mutation.preResolve!({ conversationId: "c1", content: "create a task for me" }, { tenantId: "t1", authUserId: "au1" });

      const call = (aiProvider as unknown as { complete: jest.Mock }).complete.mock.calls[0][0];
      expect(call.tools).toEqual([expect.objectContaining({ name: "task.create" })]);
      expect(call.systemPrompt).toContain("propose taking an action");
    });

    it("preResolve passes no tools (and no 'propose an action' prompt line) when nothing is allowlisted/registered", async () => {
      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
        aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const aiProvider = fakeAiProvider();
      const mutation = buildMutation(aiProvider, tx);

      await mutation.preResolve!({ conversationId: "c1", content: "hi" }, { tenantId: "t1", authUserId: "au1" });

      const call = (aiProvider as unknown as { complete: jest.Mock }).complete.mock.calls[0][0];
      expect(call.tools).toBeUndefined();
      expect(call.systemPrompt).not.toContain("propose taking an action");
    });

    it("preResolve falls back to a friendly framing when the model returns empty content alongside a tool call", async () => {
      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
        aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const aiProvider = {
        complete: jest.fn().mockResolvedValue({
          content: "",
          toolCall: { name: "task.create", input: { title: "Buy milk" } },
          stopReason: "tool_use",
          usage: { inputTokens: 5, outputTokens: 1 },
        }),
      } as unknown as AiProviderService;
      const permissionResolver = { resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions(["task:create:tenant"])) } as unknown as PermissionResolverService;
      const mutation = createAiMessageSendMutation(
        aiProvider,
        fakeTenantPrisma(tx),
        fakeEmbeddingProvider(),
        fakeRetrievalService(),
        permissionResolver,
        fakeMutationRegistry({ "task.create": taskCreateDef }),
      );

      const pre = await mutation.preResolve!({ conversationId: "c1", content: "create a task for me" }, { tenantId: "t1", authUserId: "au1" });
      expect(pre.assistantContent.length).toBeGreaterThan(0);
      expect(pre.assistantContent.toLowerCase()).toContain("confirm");
    });

    it("resolve creates an AiToolCallProposal for a valid, allowlisted tool call, linked to the new assistant message", async () => {
      const create = jest.fn().mockResolvedValueOnce({ id: "user-msg" }).mockResolvedValueOnce({ id: "assistant-msg" });
      const proposalCreate = jest.fn().mockResolvedValue({});
      const resolveTx = {
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }), update: jest.fn().mockResolvedValue({}) },
        aiMessage: { create },
        aiToolCallProposal: { create: proposalCreate },
      } as unknown as PrismaTx;

      const mutation = buildMutation(fakeAiProvider(), {}, undefined, fakeMutationRegistry({ "task.create": taskCreateDef }));
      const pre = {
        assistantContent: "I'd like to create a task — please confirm.",
        usage: { inputTokens: 5, outputTokens: 3 },
        isFirstMessage: false,
        toolCall: { name: "task.create", input: { title: "Buy milk" } },
      };

      await mutation.resolve({ conversationId: "c1", content: "create a task for me" }, context(), resolveTx, pre);

      expect(proposalCreate).toHaveBeenCalledWith({
        data: { tenantId: "t1", conversationId: "c1", messageId: "assistant-msg", mutationName: "task.create", input: { title: "Buy milk" } },
      });
    });

    it("resolve silently drops a proposal whose mutation isn't allowlisted — keeps only the text reply", async () => {
      const create = jest.fn().mockResolvedValueOnce({ id: "user-msg" }).mockResolvedValueOnce({ id: "assistant-msg" });
      const proposalCreate = jest.fn();
      const resolveTx = {
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }), update: jest.fn().mockResolvedValue({}) },
        aiMessage: { create },
        aiToolCallProposal: { create: proposalCreate },
      } as unknown as PrismaTx;

      // Registered, but not in AI_TOOL_ALLOWLIST — e.g. a security-sensitive
      // mutation the model should never be able to get proposed as a tool.
      const mutation = buildMutation(fakeAiProvider(), {}, undefined, fakeMutationRegistry({ "user.changeRole": { name: "user.changeRole", inputSchema: z.object({}) } }));
      const pre = {
        assistantContent: "Done!",
        usage: { inputTokens: 5, outputTokens: 3 },
        isFirstMessage: false,
        toolCall: { name: "user.changeRole", input: {} },
      };

      await mutation.resolve({ conversationId: "c1", content: "change my role" }, context(), resolveTx, pre);
      expect(proposalCreate).not.toHaveBeenCalled();
    });

    it("resolve silently drops a proposal whose args fail the target's own schema — never trusted just because a tool was offered", async () => {
      const create = jest.fn().mockResolvedValueOnce({ id: "user-msg" }).mockResolvedValueOnce({ id: "assistant-msg" });
      const proposalCreate = jest.fn();
      const resolveTx = {
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }), update: jest.fn().mockResolvedValue({}) },
        aiMessage: { create },
        aiToolCallProposal: { create: proposalCreate },
      } as unknown as PrismaTx;

      const mutation = buildMutation(fakeAiProvider(), {}, undefined, fakeMutationRegistry({ "task.create": taskCreateDef }));
      const pre = {
        assistantContent: "I'd like to create a task — please confirm.",
        usage: { inputTokens: 5, outputTokens: 3 },
        isFirstMessage: false,
        toolCall: { name: "task.create", input: { title: 123 } }, // fails z.string()
      };

      await mutation.resolve({ conversationId: "c1", content: "create a task for me" }, context(), resolveTx, pre);
      expect(proposalCreate).not.toHaveBeenCalled();
    });
  });

  describe("retrieval integration (Phase B)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("embeds the query, retrieves scoped to the conversation's contextRef, and folds chunks into the system prompt", async () => {
      jest.spyOn(EmbeddingProviderService, "isConfigured").mockReturnValue(true);

      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "u1", departmentId: null }) },
        aiConversation: {
          findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: { sourceType: "document", sourceId: "doc-1" } }),
        },
        aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const embeddingProvider = { embed: jest.fn().mockResolvedValue({ vectors: [[0.1, 0.2, 0.3]] }) } as unknown as EmbeddingProviderService;
      const retrievedChunks = [{ sourceType: "document", sourceId: "doc-1", sourceName: "Handbook.pdf", content: "Vacation policy is 20 days." }];
      const retrievalService = { retrieve: jest.fn().mockResolvedValue(retrievedChunks) } as unknown as RetrievalService;
      const permissionResolver = { resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions([])) } as unknown as PermissionResolverService;
      const aiProvider = fakeAiProvider("According to the handbook, 20 days.");

      const mutation = createAiMessageSendMutation(aiProvider, fakeTenantPrisma(tx), embeddingProvider, retrievalService, permissionResolver, fakeMutationRegistry());
      await mutation.preResolve!({ conversationId: "c1", content: "How many vacation days?" }, { tenantId: "t1", authUserId: "au1" });

      expect((embeddingProvider as unknown as { embed: jest.Mock }).embed).toHaveBeenCalledWith({ texts: ["How many vacation days?"], taskType: "query" });
      expect((retrievalService as unknown as { retrieve: jest.Mock }).retrieve).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ tenantId: "t1", userId: "u1" }),
        [0.1, 0.2, 0.3],
        { sourceType: "document", sourceId: "doc-1" },
        expect.any(Number),
      );

      const call = (aiProvider as unknown as { complete: jest.Mock }).complete.mock.calls[0][0];
      expect(call.systemPrompt).toContain("Handbook.pdf");
      expect(call.systemPrompt).toContain("Vacation policy is 20 days.");
    });

    it("skips embedding and retrieval entirely when no embedding provider is configured — basic chat must keep working", async () => {
      jest.spyOn(EmbeddingProviderService, "isConfigured").mockReturnValue(false);

      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
        aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const embeddingProvider = { embed: jest.fn() } as unknown as EmbeddingProviderService;
      const retrievalService = { retrieve: jest.fn() } as unknown as RetrievalService;
      const permissionResolver = { resolveEffectivePermissionsWithTx: jest.fn() } as unknown as PermissionResolverService;

      const mutation = createAiMessageSendMutation(fakeAiProvider(), fakeTenantPrisma(tx), embeddingProvider, retrievalService, permissionResolver, fakeMutationRegistry());
      await mutation.preResolve!({ conversationId: "c1", content: "hi" }, { tenantId: "t1", authUserId: "au1" });

      expect((embeddingProvider as unknown as { embed: jest.Mock }).embed).not.toHaveBeenCalled();
      expect((retrievalService as unknown as { retrieve: jest.Mock }).retrieve).not.toHaveBeenCalled();
    });

    it("falls back to no retrieval context when Stage 2 filters out every candidate", async () => {
      jest.spyOn(EmbeddingProviderService, "isConfigured").mockReturnValue(true);

      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: "u1", departmentId: null }) },
        aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1", contextRef: null }) },
        aiMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
        tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const embeddingProvider = { embed: jest.fn().mockResolvedValue({ vectors: [[0.1, 0.2, 0.3]] }) } as unknown as EmbeddingProviderService;
      const retrievalService = { retrieve: jest.fn().mockResolvedValue([]) } as unknown as RetrievalService;
      const permissionResolver = { resolveEffectivePermissionsWithTx: jest.fn().mockResolvedValue(collapsePermissions([])) } as unknown as PermissionResolverService;
      const aiProvider = fakeAiProvider("I don't have that information.");

      const mutation = createAiMessageSendMutation(aiProvider, fakeTenantPrisma(tx), embeddingProvider, retrievalService, permissionResolver, fakeMutationRegistry());
      await mutation.preResolve!({ conversationId: "c1", content: "anything?" }, { tenantId: "t1", authUserId: "au1" });

      const call = (aiProvider as unknown as { complete: jest.Mock }).complete.mock.calls[0][0];
      expect(call.systemPrompt).not.toContain("Document \"");
    });
  });

  it("resolve persists both messages, sets the title only on the first message, and re-checks ownership", async () => {
    const resolveTx = {
      aiConversation: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }),
        update: jest.fn().mockResolvedValue({}),
      },
      aiMessage: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: "user-msg" })
          .mockResolvedValueOnce({ id: "assistant-msg", content: "Here's my answer" }),
      },
    } as unknown as PrismaTx;

    const mutation = buildMutation(fakeAiProvider(), {});
    const pre = { assistantContent: "Here's my answer", usage: { inputTokens: 10, outputTokens: 5 }, isFirstMessage: true };

    const result = await mutation.resolve({ conversationId: "c1", content: "first ever message" }, context(), resolveTx, pre);

    expect((resolveTx as unknown as { aiMessage: { create: jest.Mock } }).aiMessage.create).toHaveBeenNthCalledWith(1, {
      data: { tenantId: "t1", conversationId: "c1", role: "user", content: "first ever message" },
    });
    expect((resolveTx as unknown as { aiMessage: { create: jest.Mock } }).aiMessage.create).toHaveBeenNthCalledWith(2, {
      data: { tenantId: "t1", conversationId: "c1", role: "assistant", content: "Here's my answer", usage: pre.usage },
    });
    expect((resolveTx as unknown as { aiConversation: { update: jest.Mock } }).aiConversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { updatedAt: expect.any(Date), title: "first ever message" },
    });
    expect(result).toMatchObject({ id: "assistant-msg" });
  });

  it("resolve does not set a title on a non-first message", async () => {
    const resolveTx = {
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }), update: jest.fn().mockResolvedValue({}) },
      aiMessage: { create: jest.fn().mockResolvedValue({ id: "assistant-msg" }) },
    } as unknown as PrismaTx;

    const mutation = buildMutation(fakeAiProvider(), {});
    const pre = { assistantContent: "another answer", usage: { inputTokens: 1, outputTokens: 1 }, isFirstMessage: false };

    await mutation.resolve({ conversationId: "c1", content: "a follow-up" }, context(), resolveTx, pre);

    expect((resolveTx as unknown as { aiConversation: { update: jest.Mock } }).aiConversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { updatedAt: expect.any(Date) },
    });
  });
});
