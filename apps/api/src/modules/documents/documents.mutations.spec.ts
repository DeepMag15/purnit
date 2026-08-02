import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import {
  createDocumentCreateUploadUrlMutation,
  documentCreateMutation,
  documentUpdateMutation,
  createDocumentCreateReplaceUploadUrlMutation,
  documentFinalizeReplaceMutation,
  documentSetApprovalStatusMutation,
  documentDeleteMutation,
  createDocumentGetFileUrlMutation,
} from "./documents.mutations";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";

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
    const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) } } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ projectId: "p1", fileName: "virus.exe", mimeType: "application/x-msdownload", sizeBytes: 100 }, context(["document:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an oversized file", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) } } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ projectId: "p1", fileName: "big.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 }, context(["document:create:tenant"]), tx),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when the target project is outside the actor's create scope", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "someone-else", departmentId: "other-dept" }) } } as unknown as PrismaTx;
    await expect(
      mutation.resolve({ projectId: "p1", fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 100 }, context(["document:create:department"], "d1"), tx),
    ).rejects.toThrow(ForbiddenException);
  });

  it("mints a signed upload URL when the project is in scope", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) } } as unknown as PrismaTx;
    const result = await mutation.resolve({ projectId: "p1", fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 100 }, context(["document:create:tenant"]), tx);
    expect(result).toMatchObject({ signedUrl: "https://storage/upload", token: "tok" });
  });
});

describe("document.create", () => {
  it("persists the row and logs an 'uploaded' activity", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      document: { create: jest.fn().mockResolvedValue({ id: "d1", name: "Spec.pdf" }) },
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentCreateMutation.resolve(
      { projectId: "p1", storagePath: "t1/p1/file.pdf", name: "Spec.pdf", mimeType: "application/pdf", sizeBytes: 100 },
      context(["document:create:tenant"]),
      tx,
    );

    expect((tx as unknown as { document: { create: jest.Mock } }).document.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", projectId: "p1", name: "Spec.pdf", storagePath: "t1/p1/file.pdf", mimeType: "application/pdf", sizeBytes: 100, uploadedById: "u1" },
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
    } as unknown as PrismaTx;
    await expect(documentUpdateMutation.resolve({ id: "d1", name: "New.pdf" }, context(["document:update:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("renames and logs an activity only when the name actually changed", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", name: "Old.pdf", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", name: "New.pdf" }),
      },
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
        findFirst: jest.fn().mockResolvedValue({ id: "d1", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", approvalStatus: "approved" }),
      },
      documentActivity: { create: jest.fn() },
    } as unknown as PrismaTx;

    await documentSetApprovalStatusMutation.resolve({ id: "d1", status: "approved" }, context(["document:update:tenant"]), tx);

    expect((tx as unknown as { document: { update: jest.Mock } }).document.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { approvalStatus: "approved" } });
    expect((tx as unknown as { documentActivity: { create: jest.Mock } }).documentActivity.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", documentId: "d1", actorId: "u1", type: "approval_status_changed", detail: "approved" },
    });
  });
});

describe("document.delete", () => {
  it("rejects when the document is outside the actor's delete scope", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", project: { id: "p1", ownerId: null, departmentId: "other-dept" } }) },
    } as unknown as PrismaTx;
    await expect(documentDeleteMutation.resolve({ id: "d1" }, context(["document:delete:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
  });

  it("soft-deletes and logs an activity when in scope", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", project: { id: "p1", ownerId: "u1", departmentId: null } }),
        update: jest.fn().mockResolvedValue({ id: "d1", deletedAt: new Date() }),
      },
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

  it("throws ForbiddenException when the actor can't see the parent project", async () => {
    const tx = {
      document: { findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1", storagePath: "t1/p1/f.pdf", mimeType: "application/pdf", name: "F.pdf" }) },
      project: { findFirst: jest.fn().mockResolvedValueOnce({ id: "p1", ownerId: null, departmentId: "other-dept" }).mockResolvedValueOnce(null) },
    } as unknown as PrismaTx;
    await expect(mutation.resolve({ id: "d1", mode: "view" }, context(["project:read:department"], "d1"), tx)).rejects.toThrow(ForbiddenException);
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
