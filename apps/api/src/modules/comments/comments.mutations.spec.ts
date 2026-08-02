import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { resolveValidMentions, assertCommentTargetInScope, commentCreateMutation, commentDeleteMutation } from "./comments.mutations";
import { projectsWhere } from "../projects/projects.data-sources";
import { tasksWhere } from "../tasks/tasks.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

jest.mock("../projects/projects.data-sources");
jest.mock("../tasks/tasks.data-sources");

const mockedProjectsWhere = projectsWhere as jest.Mock;
const mockedTasksWhere = tasksWhere as jest.Mock;

function context(grants: string[] = []) {
  return { tenantId: "t1", userId: "u1", userDepartmentId: null, effective: collapsePermissions(grants) };
}

afterEach(() => jest.clearAllMocks());

describe("resolveValidMentions", () => {
  it("keeps only ids that are real members of the target's project", () => {
    expect(resolveValidMentions(["u2", "u3"], ["u2"], "u1")).toEqual(["u2"]);
  });

  it("drops the author's own id even if self-mentioned", () => {
    expect(resolveValidMentions(["u1", "u2"], ["u1", "u2"], "u1")).toEqual(["u2"]);
  });

  it("dedupes repeated ids", () => {
    expect(resolveValidMentions(["u2", "u2"], ["u2"], "u1")).toEqual(["u2"]);
  });

  it("returns empty when nothing was mentioned", () => {
    expect(resolveValidMentions([], ["u2"], "u1")).toEqual([]);
  });
});

describe("assertCommentTargetInScope", () => {
  it("throws NotFoundException when the project doesn't exist in the tenant", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assertCommentTargetInScope(tx, context(), "project", "p1")).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException when the project exists but the actor has no read grant at all", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) } } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue(null);
    await expect(assertCommentTargetInScope(tx, context(), "project", "p1")).rejects.toThrow(ForbiddenException);
  });

  it("throws ForbiddenException when the project exists, actor has some grant, but not over this specific row", async () => {
    const tx = {
      project: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "p1" }) // existence check
          .mockResolvedValueOnce(null), // scoped check — not in scope
      },
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1", ownerId: "someone-else" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:own"]), "project", "p1")).rejects.toThrow(ForbiddenException);
  });

  it("passes when the project exists and is in scope", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValueOnce({ id: "p1" }).mockResolvedValueOnce({ id: "p1" }) },
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:tenant"]), "project", "p1")).resolves.toBeUndefined();
  });

  it("uses tasksWhere for entityType 'task', not projectsWhere", async () => {
    const tx = {
      task: { findFirst: jest.fn().mockResolvedValueOnce({ id: "task1" }).mockResolvedValueOnce({ id: "task1" }) },
    } as unknown as PrismaTx;
    mockedTasksWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["task:read:tenant"]), "task", "task1")).resolves.toBeUndefined();
    expect(mockedProjectsWhere).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when entityType 'document' doesn't exist", async () => {
    const tx = { document: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assertCommentTargetInScope(tx, context(["project:read:tenant"]), "document", "d1")).rejects.toThrow(NotFoundException);
  });

  it("for entityType 'document', resolves the parent project and reuses projectsWhere (visibility = parent project's)", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1" }) },
      project: { findFirst: jest.fn().mockResolvedValueOnce({ id: "p1" }) },
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:tenant"]), "document", "d1")).resolves.toBeUndefined();
    expect(mockedProjectsWhere).toHaveBeenCalledWith(tx, expect.anything(), { id: "p1" });
  });

  it("throws ForbiddenException when the actor can't see the document's parent project", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1" }) },
      project: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:department"]), "document", "d1")).rejects.toThrow(ForbiddenException);
  });
});

describe("comment.create", () => {
  it("creates a comment, records only valid mentions, and fires exactly one notification per valid mention", async () => {
    const project = { id: "p1", ownerId: "u1", members: [{ userId: "u2" }, { userId: "u3" }] };
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      comment: {
        create: jest.fn().mockResolvedValue({ id: "c1", tenantId: "t1", entityType: "project", entityId: "p1", authorId: "u1", body: "hi @u2" }),
      },
      commentMention: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });

    // u1 = self-mention (dropped), "not-a-member" = not on the project (dropped), u2 = valid.
    const result = await commentCreateMutation.resolve(
      { entityType: "project", entityId: "p1", body: "hi @u2", mentionedUserIds: ["u2", "u1", "not-a-member"] },
      context(["project:read:tenant"]),
      tx,
    );

    const mocks = tx as unknown as {
      comment: { create: jest.Mock };
      commentMention: { create: jest.Mock };
      notification: { create: jest.Mock };
    };
    expect(mocks.comment.create).toHaveBeenCalledTimes(1);
    expect(mocks.commentMention.create).toHaveBeenCalledTimes(1);
    expect(mocks.commentMention.create).toHaveBeenCalledWith({ data: { tenantId: "t1", commentId: "c1", userId: "u2" } });
    expect(mocks.notification.create).toHaveBeenCalledTimes(1);
    expect(mocks.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u2", type: "comment.mention" }) }),
    );
    expect((result as { mentionedUserIds: string[] }).mentionedUserIds).toEqual(["u2"]);
  });
});

describe("comment.delete (ownership-only, no permission gate)", () => {
  function fakeTx(comment: { id: string; authorId: string } | null) {
    return {
      comment: {
        findFirst: jest.fn().mockResolvedValue(comment),
        update: jest.fn().mockResolvedValue({ id: comment?.id, deletedAt: new Date() }),
      },
    } as unknown as PrismaTx;
  }

  it("throws NotFoundException if the comment doesn't exist", async () => {
    const tx = fakeTx(null);
    await expect(commentDeleteMutation.resolve({ id: "c1" }, context(), tx)).rejects.toThrow(NotFoundException);
  });

  it("throws ForbiddenException if the actor isn't the comment's author", async () => {
    const tx = fakeTx({ id: "c1", authorId: "someone-else" });
    await expect(commentDeleteMutation.resolve({ id: "c1" }, context(), tx)).rejects.toThrow(ForbiddenException);
  });

  it("soft-deletes when the actor is the author", async () => {
    const tx = fakeTx({ id: "c1", authorId: "u1" });
    await commentDeleteMutation.resolve({ id: "c1" }, context(), tx);
    const update = (tx as unknown as { comment: { update: jest.Mock } }).comment.update;
    expect(update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { deletedAt: expect.any(Date) } });
  });
});
