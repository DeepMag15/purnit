import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  createDocumentCreateUploadUrlMutation,
  documentCreateMutation,
  documentUpdateMutation,
  createDocumentCreateReplaceUploadUrlMutation,
  documentFinalizeReplaceMutation,
  documentRequestApprovalMutation,
  documentSetApprovalStatusMutation,
  documentDeleteMutation,
  createDocumentGetFileUrlMutation,
} from "./documents.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";

/**
 * Documents module review — every document write now asks two more questions
 * before the scope test, and a mock that cannot answer them dies on an
 * undefined delegate instead of producing the refusal the test is about:
 *
 *   1. is the project REACHABLE at all (`assertProjectReachable` — the
 *      restricted gate, which reads have had since Contextual Reporting and
 *      writes never did);
 *   2. failing scope, am I a MEMBER of it (the membership floor, without
 *      which a Lead was refused uploads to their own project).
 *
 * These defaults say "reachable, not a member" — the state every test below
 * was originally written in, so they keep asserting what they always did.
 */
const REACHABLE = () => ({ findFirst: jest.fn().mockResolvedValue({ id: "p1" }) });
const NOT_A_MEMBER = () => ({ findFirst: jest.fn().mockResolvedValue(null) });

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

const fakeSupabaseAdmin = {
  createDocumentSignedUploadUrl: jest.fn().mockResolvedValue({ path: "t1/p1/file.pdf", signedUrl: "https://storage/upload", token: "tok" }),
  createDocumentSignedUrl: jest.fn().mockResolvedValue("https://storage/download"),
} as unknown as SupabaseAdminService;

describe("document.createUploadUrl", () => {
  const mutation = createDocumentCreateUploadUrlMutation(fakeSupabaseAdmin);

  it("rejects a disallowed file type before minting any credential", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ projectId: "p1", fileName: "virus.exe", mimeType: "application/x-msdownload", sizeBytes: 100 }, context(["document:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an oversized file", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ projectId: "p1", fileName: "big.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 }, context(["document:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when the target project is outside the actor's create scope", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "someone-else", departmentId: "other-dept" }) },
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ projectId: "p1", fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 100 }, context(["document:create:department"], "d1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("mints a signed upload URL when the project is in scope", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    const result = await mutation.resolve({ projectId: "p1", fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 100 }, context(["document:create:tenant"]), tx);
    expect(result).toMatchObject({ signedUrl: "https://storage/upload", token: "tok" });
  });
});

describe("document.create", () => {
  it("persists the row and logs an 'uploaded' activity", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      projectMember: NOT_A_MEMBER(),
      document: { create: jest.fn().mockResolvedValue({ id: "d1", name: "Spec.pdf" }) },
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentCreateMutation.resolve(
      { projectId: "p1", storagePath: "t1/p1/file.pdf", name: "Spec.pdf", mimeType: "application/pdf", sizeBytes: 100 },
      context(["document:create:tenant"]),
      tx,
    );

    expect((tx as unknown as { document: { create: jest.Mock } }).document.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", projectId: "p1", name: "Spec.pdf", storagePath: "t1/p1/file.pdf", mimeType: "application/pdf", sizeBytes: 100, uploadedById: "u1", taskId: null },
    });
    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", documentId: "d1", actorId: "u1", type: "uploaded", detail: undefined },
    });
  });
});

describe("document.update (rename)", () => {
  it("rejects when the document is outside the actor's update scope", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", name: "Old.pdf", project: { id: "p1", ownerId: null, departmentId: "other-dept" } }) },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    await expect(documentUpdateMutation.resolve({ id: "d1", name: "New.pdf" }, context(["document:update:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("renames and logs an activity only when the name actually changed", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", name: "Old.pdf", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", name: "New.pdf" }),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentUpdateMutation.resolve({ id: "d1", name: "New.pdf" }, context(["document:update:tenant"]), tx);

    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalledTimes(1);
  });

  it("skips the activity log when the name is unchanged", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", name: "Same.pdf", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", name: "Same.pdf" }),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentUpdateMutation.resolve({ id: "d1", name: "Same.pdf" }, context(["document:update:tenant"]), tx);

    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).not.toHaveBeenCalled();
  });
});

describe("document.createReplaceUploadUrl + document.finalizeReplace", () => {
  it("createReplaceUploadUrl rejects when out of scope", async () => {
    const mutation = createDocumentCreateReplaceUploadUrlMutation(fakeSupabaseAdmin);
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", project: { id: "p1", ownerId: null, departmentId: "other-dept" } }) },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ id: "d1", fileName: "spec-v2.pdf", mimeType: "application/pdf", sizeBytes: 100 }, context(["document:update:department"], "d1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("createReplaceUploadUrl mints an upload URL for a fresh path when in scope", async () => {
    const mutation = createDocumentCreateReplaceUploadUrlMutation(fakeSupabaseAdmin);
    const tx = {
      document: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "d1", project: { id: "p1", ownerId: "u1", departmentId: null } })
          .mockResolvedValueOnce({ projectId: "p1" }),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    const result = await mutation.resolve({ id: "d1", fileName: "spec-v2.pdf", mimeType: "application/pdf", sizeBytes: 100 }, context(["document:update:tenant"]), tx);
    expect(result).toMatchObject({ signedUrl: "https://storage/upload" });
  });

  it("finalizeReplace snapshots the old version and bumps the current row", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({
          id: "d1",
          version: 1,
          storagePath: "t1/p1/old.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          uploadedById: "u2",
          project: { id: "p1", ownerId: "u1", departmentId: null },
        }),
        update: jest.fn().mockResolvedValue({ id: "d1", version: 2 }),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
      documentVersion: { create: jest.fn() },
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentFinalizeReplaceMutation.resolve({ id: "d1", storagePath: "t1/p1/new.pdf", mimeType: "application/pdf", sizeBytes: 200 }, context(["document:update:tenant"]), tx);

    expect((tx as unknown as { documentVersion: { create: jest.Mock } }).documentVersion.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", documentId: "d1", version: 1, storagePath: "t1/p1/old.pdf", mimeType: "application/pdf", sizeBytes: 100, createdById: "u2" },
    });
    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { storagePath: "t1/p1/new.pdf", mimeType: "application/pdf", sizeBytes: 200, version: 2, uploadedById: "u1" },
    });
    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", documentId: "d1", actorId: "u1", type: "replaced", detail: "v1 -> v2" },
    });
  });
});

describe("document.setApprovalStatus", () => {
  it("sets the status and logs an activity", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", uploadedById: "someone-else", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", approvalStatus: "approved" }),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentSetApprovalStatusMutation.resolve({ id: "d1", status: "approved" }, context(["document:approve:tenant"]), tx);

    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { approvalStatus: "approved" } });
    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", documentId: "d1", actorId: "u1", type: "approval_status_changed", detail: "approved" },
    });
  });

  /* ARCHITECTURE.md §15.1, the seventh rule — separation of duties. Holding
   * the grant is not enough: the person who put the document there is never
   * the person who signs it off, or "approved" records nothing but that
   * someone approved of their own work. */
  it("refuses the uploader their own document, even holding document:approve at tenant scope", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", uploadedById: "u1", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn(),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await expect(documentSetApprovalStatusMutation.resolve({ id: "d1", status: "approved" }, context(["document:approve:tenant"]), tx)).rejects.toThrow(ForbiddenException);
    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).not.toHaveBeenCalled();
  });
});

/**
 * Documents module review — requesting an approval is not deciding one.
 *
 * ⚠️ `document.setApprovalStatus` gained `requiredPermission:
 * "document:approve"` in the Projects review, which was right for approving
 * and wrong for the "Request approval" button sharing the same mutation: the
 * uploader — the one person that button exists for — got
 * `403 Missing permission "document:approve"`. A gate cannot see which value
 * is being set, so the two halves are two mutations, split exactly as
 * `task.submitForReview` / `task.review` were and for the same reason.
 */
describe("document.requestApproval", () => {
  const txFor = (doc: Record<string, unknown>, project: unknown = { id: "p1" }) =>
    ({
      document: { findFirst: jest.fn().mockResolvedValue(doc), update: jest.fn().mockResolvedValue({ id: "d1", approvalStatus: "pending" }) },
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      documentActivity: { create: jest.fn() },
    }) as unknown as PrismaTx;

  // The whole point of the split: no document:approve grant anywhere here.
  it("lets the uploader ask, holding no approval permission at all", async () => {
    const tx = txFor({ id: "d1", uploadedById: "u1", projectId: "p1", approvalStatus: null });
    await documentRequestApprovalMutation.resolve({ id: "d1" }, context([]), tx);
    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { approvalStatus: "pending" },
    });
    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", documentId: "d1", actorId: "u1", type: "approval_requested" },
    });
  });

  it("refuses anyone who is not the uploader, even holding document:approve", async () => {
    const tx = txFor({ id: "d1", uploadedById: "someone-else", projectId: "p1", approvalStatus: null });
    await expect(documentRequestApprovalMutation.resolve({ id: "d1" }, context(["document:approve:tenant"]), tx)).rejects.toThrow(ForbiddenException);
    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).not.toHaveBeenCalled();
  });

  // "My own document" never means one sitting in a project I cannot open —
  // otherwise this ungated mutation would be a way back into a restricted one.
  it("refuses when the project is unreachable, before looking at ownership", async () => {
    const tx = txFor({ id: "d1", uploadedById: "u1", projectId: "p1", approvalStatus: null }, null);
    await expect(documentRequestApprovalMutation.resolve({ id: "d1" }, context([]), tx)).rejects.toThrow(NotFoundException);
    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).not.toHaveBeenCalled();
  });

  it("refuses to re-open an already-approved document", async () => {
    const tx = txFor({ id: "d1", uploadedById: "u1", projectId: "p1", approvalStatus: "approved" });
    await expect(documentRequestApprovalMutation.resolve({ id: "d1" }, context([]), tx)).rejects.toThrow(BadRequestException);
  });

  // A rejected document is exactly what a resubmission is for.
  it("lets a rejected document be sent back for another look", async () => {
    const tx = txFor({ id: "d1", uploadedById: "u1", projectId: "p1", approvalStatus: "rejected" });
    await expect(documentRequestApprovalMutation.resolve({ id: "d1" }, context([]), tx)).resolves.toBeDefined();
  });
});

describe("document.delete", () => {
  it("rejects when the document is outside the actor's delete scope", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", project: { id: "p1", ownerId: null, departmentId: "other-dept" } }) },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
    } as unknown as PrismaTx;
    await expect(documentDeleteMutation.resolve({ id: "d1" }, context(["document:delete:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("soft-deletes and logs an activity when in scope", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", deletedAt: new Date() }),
      },
      project: REACHABLE(),
      projectMember: NOT_A_MEMBER(),
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentDeleteMutation.resolve({ id: "d1" }, context(["document:delete:tenant"]), tx);

    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { deletedAt: expect.any(Date) } });
  });
});

describe("document.getFileUrl (no permission gate, visibility-only)", () => {
  const mutation = createDocumentGetFileUrlMutation(fakeSupabaseAdmin);

  it("throws NotFoundException when the document doesn't exist", async () => {
    const tx = { document: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(mutation.resolve({ id: "d1", mode: "view" }, context([]), tx)).rejects.toThrow(NotFoundException);
  });

  /**
   * ⚠️ Was ForbiddenException. A 403 here confirmed the file exists to
   * someone who cannot see it — the one thing this check is for. It is also
   * one query now rather than existence-then-scope, which is why the old
   * two-value mock sequence is gone.
   */
  it("throws NotFoundException — not Forbidden — when the actor can't see the parent project", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1", storagePath: "t1/p1/f.pdf", mimeType: "application/pdf", name: "F.pdf" }) },
      project: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaTx;
    const err = await mutation.resolve({ id: "d1", mode: "view" }, context(["project:read:department"], "d1"), tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
  });

  it("mints a download URL with the filename in 'download' mode, and without one in 'view' mode", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1", storagePath: "t1/p1/f.pdf", mimeType: "application/pdf", name: "F.pdf" }) },
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
    } as unknown as PrismaTx;

    await mutation.resolve({ id: "d1", mode: "download" }, context(["project:read:tenant"]), tx);
    expect(fakeSupabaseAdmin.createDocumentSignedUrl).toHaveBeenLastCalledWith("t1/p1/f.pdf", "F.pdf");

    await mutation.resolve({ id: "d1", mode: "view" }, context(["project:read:tenant"]), tx);
    expect(fakeSupabaseAdmin.createDocumentSignedUrl).toHaveBeenLastCalledWith("t1/p1/f.pdf", undefined);
  });

  it("resolves a specific past version's storagePath when versionId is given", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1", storagePath: "t1/p1/current.pdf", mimeType: "application/pdf", name: "F.pdf" }) },
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      documentVersion: { findFirst: jest.fn().mockResolvedValue({ id: "v1", documentId: "d1", storagePath: "t1/p1/old.pdf", mimeType: "application/pdf" }) },
    } as unknown as PrismaTx;

    await mutation.resolve({ id: "d1", mode: "view", versionId: "v1" }, context(["project:read:tenant"]), tx);
    expect(fakeSupabaseAdmin.createDocumentSignedUrl).toHaveBeenLastCalledWith("t1/p1/old.pdf", undefined);
  });
});
