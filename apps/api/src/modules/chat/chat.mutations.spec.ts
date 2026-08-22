import { NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  assertConversationMember,
  conversationCreateChannelMutation,
  conversationCreateDmMutation,
  conversationAddMemberMutation,
  conversationArchiveMutation,
  messageSendMutation,
  messageDeleteMutation,
  conversationMarkReadMutation,
} from "./chat.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

describe("assertConversationMember", () => {
  it("throws NotFoundException when the conversation doesn't exist (or is archived)", async () => {
    const tx = { conversation: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assertConversationMember(tx, context(), "c1")).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException when the conversation exists but the actor isn't a member", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      conversationMember: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    await expect(assertConversationMember(tx, context(), "c1")).rejects.toThrow(ForbiddenException);
  });

  it("passes when the actor is a member", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      conversationMember: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
    } as unknown as PrismaTx;
    await expect(assertConversationMember(tx, context(), "c1")).resolves.toEqual({ id: "c1" });
  });
});

describe("conversation.createChannel", () => {
  it("creates the conversation and adds the creator plus valid extra members", async () => {
    const tx = {
      conversation: { create: jest.fn().mockResolvedValue({ id: "c1", type: "channel", name: "general" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u2" }]) }, // "u3" is not a real tenant user, dropped
      conversationMember: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await conversationCreateChannelMutation.resolve({ name: "general", memberIds: ["u2", "u3", "u1"] }, context(), tx);

    const mocks = tx as unknown as { conversationMember: { create: jest.Mock } };
    expect(mocks.conversationMember.create).toHaveBeenCalledTimes(2); // creator (u1) + u2; u3 dropped, u1 deduped
    expect(mocks.conversationMember.create).toHaveBeenCalledWith({ data: { tenantId: "t1", conversationId: "c1", userId: "u1" } });
    expect(mocks.conversationMember.create).toHaveBeenCalledWith({ data: { tenantId: "t1", conversationId: "c1", userId: "u2" } });
  });
});

describe("conversation.createDm", () => {
  it("throws BadRequestException when targeting yourself", async () => {
    const tx = {} as unknown as PrismaTx;
    await expect(conversationCreateDmMutation.resolve({ otherUserId: "u1" }, context(), tx)).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the other user doesn't exist in this tenant", async () => {
    const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(conversationCreateDmMutation.resolve({ otherUserId: "u2" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("returns the existing dm conversation instead of creating a duplicate", async () => {
    const existingDm = { id: "dm1", type: "dm", members: [{ userId: "u1" }, { userId: "u2" }] };
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      conversation: { findMany: jest.fn().mockResolvedValue([existingDm]), create: jest.fn() },
    } as unknown as PrismaTx;

    const result = await conversationCreateDmMutation.resolve({ otherUserId: "u2" }, context(), tx);

    expect(result).toEqual(existingDm);
    expect((tx as unknown as { conversation: { create: jest.Mock } }).conversation.create).not.toHaveBeenCalled();
  });

  it("creates a new dm with exactly 2 members when none exists yet", async () => {
    const tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u2" }) },
      conversation: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: "dm1", type: "dm" }) },
      conversationMember: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;

    await conversationCreateDmMutation.resolve({ otherUserId: "u2" }, context(), tx);

    const mocks = tx as unknown as { conversationMember: { create: jest.Mock } };
    expect(mocks.conversationMember.create).toHaveBeenCalledTimes(2);
    expect(mocks.conversationMember.create).toHaveBeenCalledWith({ data: { tenantId: "t1", conversationId: "dm1", userId: "u1" } });
    expect(mocks.conversationMember.create).toHaveBeenCalledWith({ data: { tenantId: "t1", conversationId: "dm1", userId: "u2" } });
  });
});

describe("conversation.addMember", () => {
  it("allows a self-join to a public channel with no prior membership", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", type: "channel", isPrivate: false }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "m1", conversationId: "c1", userId: "u1" }]),
    } as unknown as PrismaTx;

    await expect(conversationAddMemberMutation.resolve({ conversationId: "c1", userId: "u1" }, context(), tx)).resolves.toBeDefined();
  });

  it("rejects a self-join to a private channel", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", type: "channel", isPrivate: true }) },
    } as unknown as PrismaTx;
    await expect(conversationAddMemberMutation.resolve({ conversationId: "c1", userId: "u1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects adding someone else when the caller isn't already a member", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", type: "channel", isPrivate: true }) },
      conversationMember: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    await expect(conversationAddMemberMutation.resolve({ conversationId: "c1", userId: "u2" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("rejects adding a member to a dm", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "dm1", type: "dm", isPrivate: true }) },
    } as unknown as PrismaTx;
    await expect(conversationAddMemberMutation.resolve({ conversationId: "dm1", userId: "u2" }, context(), tx)).rejects.toThrow(BadRequestException);
  });

  it("falls back to reading the existing row when a concurrent insert already won (no error, no aborted transaction)", async () => {
    // Real bug caught during this submodule's own live verification, via two
    // truly concurrent requests: a findFirst-then-create race here isn't
    // atomic, and — surprisingly — Prisma 7's own `upsert` still threw a raw
    // P2002 under real concurrency rather than compiling to a single atomic
    // statement. Both left the transaction aborted (Postgres kills the whole
    // transaction the instant one statement in it errors), so even a
    // recovery query on that same tx failed too. `INSERT ... ON CONFLICT DO
    // NOTHING` is the one path that never errors on conflict — this test
    // simulates the "someone else's insert won" case (empty RETURNING) and
    // confirms the fallback read still succeeds on the same transaction.
    const existingRow = { id: "m1", conversationId: "c1", userId: "u1" };
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", type: "channel", isPrivate: false }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: "u1" }) },
      conversationMember: { findFirst: jest.fn().mockResolvedValue(existingRow) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaTx;

    await expect(conversationAddMemberMutation.resolve({ conversationId: "c1", userId: "u1" }, context(), tx)).resolves.toEqual(existingRow);
  });
});

describe("conversation.archive (creator-only, no permission gate)", () => {
  it("throws ForbiddenException when the actor isn't the creator", async () => {
    const tx = { conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1", createdById: "someone-else" }) } } as unknown as PrismaTx;
    await expect(conversationArchiveMutation.resolve({ conversationId: "c1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("archives when the actor is the creator", async () => {
    const tx = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", createdById: "u1" }),
        update: jest.fn().mockResolvedValue({ id: "c1", archivedAt: new Date() }),
      },
    } as unknown as PrismaTx;
    await conversationArchiveMutation.resolve({ conversationId: "c1" }, context(), tx);
    expect((tx as unknown as { conversation: { update: jest.Mock } }).conversation.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { archivedAt: expect.any(Date) },
    });
  });
});

describe("message.send", () => {
  it("sends the message and notifies only valid, non-self mentions", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      conversationMember: {
        findFirst: jest.fn().mockResolvedValue({ id: "m1" }),
        findMany: jest.fn().mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]),
      },
      message: { create: jest.fn().mockResolvedValue({ id: "msg1", conversationId: "c1", authorId: "u1", body: "hi @u2" }) },
      notification: { create: jest.fn().mockResolvedValue({}) },
      embeddingJob: { create: jest.fn() }, // AI RAG Phase C
    } as unknown as PrismaTx;

    const result = await messageSendMutation.resolve(
      { conversationId: "c1", body: "hi @u2", mentionedUserIds: ["u2", "u1", "not-a-member"] },
      context(),
      tx,
    );

    const mocks = tx as unknown as { notification: { create: jest.Mock } };
    expect(mocks.notification.create).toHaveBeenCalledTimes(1);
    expect(mocks.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u2", type: "message.mention" }) }));
    expect((result as { mentionedUserIds: string[] }).mentionedUserIds).toEqual(["u2"]);
  });
});

describe("message.delete (ownership-only, no permission gate)", () => {
  function fakeTx(message: { id: string; authorId: string } | null) {
    return {
      message: {
        findFirst: jest.fn().mockResolvedValue(message),
        update: jest.fn().mockResolvedValue({ id: message?.id, deletedAt: new Date() }),
      },
    } as unknown as PrismaTx;
  }

  it("throws NotFoundException if the message doesn't exist", async () => {
    const tx = fakeTx(null);
    await expect(messageDeleteMutation.resolve({ id: "msg1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException if the actor isn't the message's author", async () => {
    const tx = fakeTx({ id: "msg1", authorId: "someone-else" });
    await expect(messageDeleteMutation.resolve({ id: "msg1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("soft-deletes when the actor is the author", async () => {
    const tx = fakeTx({ id: "msg1", authorId: "u1" });
    await messageDeleteMutation.resolve({ id: "msg1" }, context(), tx);
    expect(tx.message.update).toHaveBeenCalledWith({ where: { id: "msg1" }, data: { deletedAt: expect.any(Date) } });
  });
});

describe("conversation.markRead", () => {
  it("sets lastReadAt for the caller's own membership", async () => {
    const tx = {
      conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      conversationMember: {
        findFirst: jest.fn().mockResolvedValue({ id: "m1" }),
        update: jest.fn().mockResolvedValue({ id: "m1", lastReadAt: new Date() }),
      },
    } as unknown as PrismaTx;

    await conversationMarkReadMutation.resolve({ conversationId: "c1" }, context(), tx);

    const mocks = tx as unknown as { conversationMember: { update: jest.Mock } };
    expect(mocks.conversationMember.update).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: "c1", userId: "u1" } },
      data: { lastReadAt: expect.any(Date) },
    });
  });
});
