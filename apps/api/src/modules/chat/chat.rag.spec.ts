import { ForbiddenException } from "@nestjs/common";
import { messageRagHandler } from "./chat.rag";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { DataSourceContext } from "../../data-sources/data-source-registry.service";
import { collapsePermissions } from "../../rbac/permission-collapse";

function ctx() {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions([]) } satisfies DataSourceContext;
}

describe("messageRagHandler", () => {
  it("has sourceType 'message'", () => {
    expect(messageRagHandler.sourceType).toBe("message");
  });

  describe("checkVisibilityAndGetName", () => {
    it("returns null when the message is gone/soft-deleted", async () => {
      const tx = { message: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await messageRagHandler.checkVisibilityAndGetName(tx, ctx(), "msg1")).toBeNull();
    });

    it("returns a generic label when the actor is a conversation member", async () => {
      const tx = {
        message: { findFirst: jest.fn().mockResolvedValue({ id: "msg1", conversationId: "c1" }) },
        conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
        conversationMember: { findFirst: jest.fn().mockResolvedValue({ id: "cm1" }) },
      } as unknown as PrismaTx;
      expect(await messageRagHandler.checkVisibilityAndGetName(tx, ctx(), "msg1")).toBe("Chat message");
    });

    it("propagates ForbiddenException for a non-member (caught by RetrievalService's own wrapper, not here)", async () => {
      const tx = {
        message: { findFirst: jest.fn().mockResolvedValue({ id: "msg1", conversationId: "c1" }) },
        conversation: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
        conversationMember: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaTx;
      await expect(messageRagHandler.checkVisibilityAndGetName(tx, ctx(), "msg1")).rejects.toThrow(ForbiddenException);
    });
  });

  describe("extractText", () => {
    it("returns null when the message is gone", async () => {
      const tx = { message: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
      expect(await messageRagHandler.extractText(tx, "t1", "msg1")).toBeNull();
    });

    it("returns the message body", async () => {
      const tx = { message: { findFirst: jest.fn().mockResolvedValue({ body: "Let's ship this" }) } } as unknown as PrismaTx;
      expect(await messageRagHandler.extractText(tx, "t1", "msg1")).toBe("Let's ship this");
    });
  });
});
