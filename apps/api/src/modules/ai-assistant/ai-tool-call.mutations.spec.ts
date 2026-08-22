import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { createAiToolCallConfirmMutation, createAiToolCallReplyMutation } from "./ai-tool-call.mutations";
import { collapsePermissions } from "../../rbac/permission-collapse";
import type { PrismaTx, TenantPrismaService } from "../../tenancy/tenant-prisma.service";
import type { AiProviderService } from "../../ai/provider/ai-provider.service";
import type { MutationRegistry } from "../../mutations/mutation-registry.service";

function context(userId = "u1", grants: string[] = []) {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions(grants) };
}

function fakeTenantPrisma(tx: unknown, tenant: { id: string; name: string } | null = { id: "t1", name: "Acme" }) {
  return {
    run: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn(tx)),
    root: { tenant: { findUnique: jest.fn().mockResolvedValue(tenant) } },
  } as unknown as TenantPrismaService;
}

describe("aiToolCall.confirm", () => {
  const targetResolve = jest.fn().mockResolvedValue({ id: "task-1", title: "Buy milk" });
  const targetDef = { name: "task.create", inputSchema: z.object({ title: z.string() }), requiredPermission: "task:create", resolve: targetResolve };

  function fakeRegistry(def: unknown = targetDef) {
    return { get: jest.fn().mockReturnValue(def) } as unknown as MutationRegistry;
  }

  beforeEach(() => targetResolve.mockClear());

  it("requires no permission of its own — ownership-only, same treatment as every AI Assistant mutation", () => {
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma({}), fakeRegistry());
    expect(mutation.requiredPermission).toBeUndefined();
  });

  it("preResolve throws NotFoundException for a proposal that doesn't exist", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) }, aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue(null) } };
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma(tx), fakeRegistry());
    await expect(mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(NotFoundException);
  });

  it("preResolve throws the same NotFoundException for a proposal that belongs to a different user's conversation — never leaks existence", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", mutationName: "task.create", input: {}, status: "pending" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue(null) }, // owned by someone else
    };
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma(tx), fakeRegistry());
    await expect(mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(NotFoundException);
  });

  it("preResolve throws BadRequestException for an already-executed proposal", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", mutationName: "task.create", input: {}, status: "executed" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
    };
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma(tx), fakeRegistry());
    await expect(mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(BadRequestException);
  });

  it("preResolve throws ForbiddenException when the proposal's mutationName isn't (or is no longer) allowlisted", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", mutationName: "user.changeRole", input: {}, status: "pending" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
    };
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma(tx), fakeRegistry());
    await expect(mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(ForbiddenException);
  });

  it("preResolve throws BadRequestException when the stored input no longer parses against the target's current schema", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", mutationName: "task.create", input: { title: 123 }, status: "pending" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
    };
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma(tx), fakeRegistry());
    await expect(mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(BadRequestException);
  });

  it("preResolve succeeds for a well-formed, allowlisted, owned, pending proposal", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", mutationName: "task.create", input: { title: "Buy milk" }, status: "pending" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
    };
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma(tx), fakeRegistry());
    const pre = await mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" });
    expect(pre.validatedInput).toEqual({ title: "Buy milk" });
    expect(pre.targetDef).toBe(targetDef);
  });

  it("resolve throws NotFoundException when the proposal was already claimed by a concurrent confirm (updateMany count !== 1)", async () => {
    const tx = { aiToolCallProposal: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } } as unknown as PrismaTx;
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma({}), fakeRegistry());
    const pre = { proposal: { id: "p1", conversationId: "c1", mutationName: "task.create", input: {} }, targetDef, validatedInput: { title: "x" }, targetPre: undefined };
    await expect(mutation.resolve({ proposalId: "p1" }, context("u1", ["task:create:tenant"]), tx, pre)).rejects.toThrow(NotFoundException);
    expect(targetResolve).not.toHaveBeenCalled();
  });

  it("resolve throws ForbiddenException — and never executes the target — when the CONFIRMING user's current permissions lack the target's requiredPermission, even though the proposal is real and well-formed", async () => {
    const tx = { aiToolCallProposal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as unknown as PrismaTx;
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma({}), fakeRegistry());
    const pre = { proposal: { id: "p1", conversationId: "c1", mutationName: "task.create", input: {} }, targetDef, validatedInput: { title: "x" }, targetPre: undefined };
    // A different user, or the same user whose grants have since changed —
    // either way, zero task:create grant.
    await expect(mutation.resolve({ proposalId: "p1" }, context("u2", []), tx, pre)).rejects.toThrow(ForbiddenException);
    expect(targetResolve).not.toHaveBeenCalled();
  });

  it("resolve executes the target mutation's own resolve(), records a result summary, and persists a tool-role message — the real dispatch path, not a duplicate", async () => {
    const create = jest.fn().mockResolvedValue({});
    const tx = {
      aiToolCallProposal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
      aiMessage: { create },
    } as unknown as PrismaTx;
    const mutation = createAiToolCallConfirmMutation(fakeTenantPrisma({}), fakeRegistry());
    const pre = { proposal: { id: "p1", conversationId: "c1", mutationName: "task.create", input: {} }, targetDef, validatedInput: { title: "Buy milk" }, targetPre: undefined };

    const ctx = context("u1", ["task:create:tenant"]);
    await mutation.resolve({ proposalId: "p1" }, ctx, tx, pre);

    expect(targetResolve).toHaveBeenCalledWith({ title: "Buy milk" }, ctx, tx, undefined);
    expect((tx as unknown as { aiToolCallProposal: { update: jest.Mock } }).aiToolCallProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: expect.objectContaining({ resultSummary: expect.stringContaining("task.create") }) }),
    );
    expect(create).toHaveBeenCalledWith({ data: { tenantId: "t1", conversationId: "c1", role: "tool", content: expect.stringContaining("task.create") } });
  });
});

describe("aiToolCall.reply", () => {
  function fakeAiProvider(content = "I created the task for you.") {
    return { complete: jest.fn().mockResolvedValue({ content, stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 3 } }) } as unknown as AiProviderService;
  }

  it("preResolve throws BadRequestException when the proposal hasn't been confirmed yet", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", status: "pending" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
    };
    const mutation = createAiToolCallReplyMutation(fakeAiProvider(), fakeTenantPrisma(tx));
    await expect(mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" })).rejects.toThrow(BadRequestException);
  });

  it("preResolve calls the provider without tools, over the conversation's history including the tool-result message", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      aiToolCallProposal: { findFirst: jest.fn().mockResolvedValue({ id: "p1", conversationId: "c1", status: "executed" }) },
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([
          { role: "tool", content: 'Tool "task.create" executed successfully. Result: {"id":"task-1"}', createdAt: new Date("2026-01-01") },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      tenantConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const aiProvider = fakeAiProvider();
    const mutation = createAiToolCallReplyMutation(aiProvider, fakeTenantPrisma(tx));

    const pre = await mutation.preResolve!({ proposalId: "p1" }, { tenantId: "t1", authUserId: "au1" });

    expect(pre.conversationId).toBe("c1");
    expect(pre.assistantContent).toBe("I created the task for you.");
    const call = (aiProvider as unknown as { complete: jest.Mock }).complete.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
    expect(call.messages).toEqual([{ role: "tool", content: 'Tool "task.create" executed successfully. Result: {"id":"task-1"}' }]);
  });

  it("resolve persists the final assistant message and bumps the conversation's updatedAt", async () => {
    const create = jest.fn().mockResolvedValue({ id: "final-msg" });
    const resolveTx = {
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }), update: jest.fn().mockResolvedValue({}) },
      aiMessage: { create },
    } as unknown as PrismaTx;
    const mutation = createAiToolCallReplyMutation(fakeAiProvider(), fakeTenantPrisma({}));
    const pre = { conversationId: "c1", assistantContent: "I created the task for you.", usage: { inputTokens: 5, outputTokens: 3 } };

    const result = await mutation.resolve({ proposalId: "p1" }, context(), resolveTx, pre);

    expect(create).toHaveBeenCalledWith({
      data: { tenantId: "t1", conversationId: "c1", role: "assistant", content: "I created the task for you.", usage: pre.usage },
    });
    expect((resolveTx as unknown as { aiConversation: { update: jest.Mock } }).aiConversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(result).toMatchObject({ id: "final-msg" });
  });
});
