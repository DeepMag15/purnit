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

/**
 * ⚠️ Every "throws ForbiddenException" case below used to assert 403.
 *
 * This check was a private re-implementation of `assertProjectVisible`, and
 * when the Documents review made the real one answer **404** for both "no such
 * project" and "not yours", the copy kept answering 403 — so Comments alone
 * told an outsider which restricted projects exist. It now calls the shared
 * gate, and these assert the shared gate's answer.
 *
 * The task cases also cover the two ownership floors added here: a Student
 * holds no `task:read` at all and was refused the conversation on their own
 * submission.
 */
describe("assertCommentTargetInScope", () => {
  const visible = () => ({ findFirst: jest.fn().mockResolvedValue({ id: "p1" }) });
  const hidden = () => ({ findFirst: jest.fn().mockResolvedValue(null) });
  const notAMember = () => ({ findFirst: jest.fn().mockResolvedValue(null) });

  it("throws NotFoundException when the project doesn't exist in the tenant", async () => {
    const tx = { project: hidden() } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(), "project", "p1")).rejects.toThrow(NotFoundException);
  });

  it("answers NotFound — not Forbidden — for a project the actor cannot see", async () => {
    const tx = { project: hidden() } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1", ownerId: "someone-else" });
    const err = await assertCommentTargetInScope(tx, context(["project:read:own"]), "project", "p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
  });

  it("gives a hidden project and a missing one the identical answer", async () => {
    const answer = async () => {
      const tx = { project: hidden() } as unknown as PrismaTx;
      mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
      return assertCommentTargetInScope(tx, context(["project:read:tenant"]), "project", "p1").catch((e: { status?: number }) => e.status);
    };
    expect(await answer()).toBe(404);
  });

  it("passes when the project exists and is in scope", async () => {
    const tx = { project: visible() } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:tenant"]), "project", "p1")).resolves.toBeUndefined();
  });

  it("throws NotFoundException when entityType 'document' doesn't exist", async () => {
    const tx = { document: hidden(), project: visible() } as unknown as PrismaTx;
    await expect(assertCommentTargetInScope(tx, context(["project:read:tenant"]), "document", "d1")).rejects.toThrow(NotFoundException);
  });

  it("for a document, visibility is entirely its parent project's", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ projectId: "p1" }) },
      project: visible(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:tenant"]), "document", "d1")).resolves.toBeUndefined();
    expect(mockedProjectsWhere).toHaveBeenCalledWith(tx, expect.anything(), { id: "p1" });
  });

  it("answers NotFound when the document's parent project is out of reach", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ projectId: "p1" }) },
      project: hidden(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["project:read:department"]), "document", "d1")).rejects.toThrow(NotFoundException);
  });

  it("uses tasksWhere for a task, once the project is reachable", async () => {
    const tx = {
      task: { findFirst: jest.fn().mockResolvedValueOnce({ id: "task1", projectId: "p1", assigneeId: "someone" }).mockResolvedValueOnce({ id: "task1" }) },
      project: visible(),
      projectMember: notAMember(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    mockedTasksWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["task:read:tenant"]), "task", "task1")).resolves.toBeUndefined();
  });

  /**
   * ⚠️ The Student case, pinned. They hold no `task:read`, so `tasksWhere`
   * returns null and the old code refused them 403 on the conversation about
   * their own submission — their page read "Task not found, or you don't have
   * access to it." Being the assignee is its own reason to be in the room.
   */
  it("lets the ASSIGNEE join, with no task:read grant at all", async () => {
    const tx = {
      task: { findFirst: jest.fn().mockResolvedValue({ id: "task1", projectId: "p1", assigneeId: "u1" }) },
      project: visible(),
      projectMember: notAMember(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    mockedTasksWhere.mockResolvedValue(null);
    await expect(assertCommentTargetInScope(tx, context([]), "task", "task1")).resolves.toBeUndefined();
  });

  it("lets the project's OWNER join, with no task:read grant at all", async () => {
    const tx = {
      task: { findFirst: jest.fn().mockResolvedValue({ id: "task1", projectId: "p1", assigneeId: "someone-else" }) },
      // reachable, and owned by the caller
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
      projectMember: notAMember(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    mockedTasksWhere.mockResolvedValue(null);
    await expect(assertCommentTargetInScope(tx, context([]), "task", "task1")).resolves.toBeUndefined();
  });

  /** ⚠️ The floor must widen who joins a conversation, never which projects
   * are visible: an unreachable project is refused before any floor runs. */
  it("still refuses a task in a project the actor cannot reach, assignee or not", async () => {
    const tx = {
      task: { findFirst: jest.fn().mockResolvedValue({ id: "task1", projectId: "p1", assigneeId: "u1" }) },
      project: hidden(),
      projectMember: notAMember(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    mockedTasksWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["task:read:tenant"]), "task", "task1")).rejects.toThrow(NotFoundException);
  });

  it("refuses a stranger: no scope, not the assignee, not on the project", async () => {
    const tx = {
      task: { findFirst: jest.fn().mockResolvedValueOnce({ id: "task1", projectId: "p1", assigneeId: "someone-else" }).mockResolvedValueOnce(null) },
      project: { findFirst: jest.fn().mockResolvedValueOnce({ id: "p1" }).mockResolvedValueOnce(null) },
      projectMember: notAMember(),
    } as unknown as PrismaTx;
    mockedProjectsWhere.mockResolvedValue({ tenantId: "t1" });
    mockedTasksWhere.mockResolvedValue({ tenantId: "t1" });
    await expect(assertCommentTargetInScope(tx, context(["task:read:own"]), "task", "task1")).rejects.toThrow(NotFoundException);
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
