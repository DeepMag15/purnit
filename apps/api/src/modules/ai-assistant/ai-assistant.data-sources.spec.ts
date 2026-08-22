import { NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { assertConversationOwner, aiConversationsListDataSource, aiConversationMessagesDataSource } from "./ai-assistant.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(userId = "u1") {
  return { tenantId: "t1", userId, userDepartmentId: null, effective: collapsePermissions([]) };
}

describe("assertConversationOwner", () => {
  it("throws NotFoundException when the conversation doesn't exist or belongs to someone else", async () => {
    const tx = { aiConversation: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assertConversationOwner(tx, context(), "c1")).rejects.toThrow(NotFoundException);
  });

  it("passes when the conversation belongs to the caller", async () => {
    const tx = { aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) } } as unknown as PrismaTx;
    await expect(assertConversationOwner(tx, context(), "c1")).resolves.toMatchObject({ id: "c1" });
  });
});

describe("aiConversations.list", () => {
  it("scopes to the caller's own tenant+user, excludes archived, orders by updatedAt desc", async () => {
    const tx = { aiConversation: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaTx;
    await aiConversationsListDataSource.resolve({}, context("u1"), tx);
    expect((tx as unknown as { aiConversation: { findMany: jest.Mock } }).aiConversation.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", userId: "u1", archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  });
});

describe("aiConversation.messages", () => {
  it("throws when the conversation isn't the caller's", async () => {
    const tx = { aiConversation: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(aiConversationMessagesDataSource.resolve({ conversationId: "c1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("returns messages for an owned conversation, with toolCall null when no proposal is linked", async () => {
    const tx = {
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([{ id: "m1", conversationId: "c1", role: "user", content: "hi", createdAt: new Date(), toolCallProposal: null }]),
      },
    } as unknown as PrismaTx;

    const result = (await aiConversationMessagesDataSource.resolve({ conversationId: "c1" }, context(), tx)) as { id: string; toolCall: unknown }[];
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m1");
    expect(result[0]!.toolCall).toBeNull();
  });

  it("nests the linked tool-call proposal on a message that has one (Phase D)", async () => {
    const tx = {
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", userId: "u1" }) },
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "m1",
            conversationId: "c1",
            role: "assistant",
            content: "I'd like to create a task — please confirm.",
            createdAt: new Date(),
            toolCallProposal: { id: "p1", mutationName: "task.create", input: { title: "Buy milk" }, status: "pending" },
          },
        ]),
      },
    } as unknown as PrismaTx;

    const result = (await aiConversationMessagesDataSource.resolve({ conversationId: "c1" }, context(), tx)) as {
      toolCall: { proposalId: string; mutationName: string; input: unknown; status: string } | null;
    }[];
    expect(result[0]!.toolCall).toEqual({ proposalId: "p1", mutationName: "task.create", input: { title: "Buy milk" }, status: "pending" });
  });
});
