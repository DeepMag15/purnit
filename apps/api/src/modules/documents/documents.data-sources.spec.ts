import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { collapsePermissions } from "../../rbac/permission-collapse";
import { assertProjectVisible, documentsListDataSource, documentDetailDataSource } from "./documents.data-sources";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

function context(grants: string[] = [], userDepartmentId: string | null = null) {
  return { tenantId: "t1", userId: "u1", userDepartmentId, effective: collapsePermissions(grants) };
}

describe("assertProjectVisible", () => {
  it("throws NotFoundException when the project doesn't exist in this tenant", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(assertProjectVisible(tx, context(["project:read:tenant"]), "p1")).rejects.toThrow(NotFoundException);
  });

  /**
   * ⚠️ Documents module review — this used to expect ForbiddenException.
   *
   * A 403 here told anyone guessing ids that a project exists and they just
   * cannot see it; a 404 for the missing case made the two distinguishable.
   * Documents was the only module that drew that distinction (ARCHITECTURE.md
   * §15.1, rule 2), and the existence of a patient's chart or a student's
   * submissions folder is exactly what it should not confirm.
   *
   * It is also now ONE query rather than an existence check followed by a
   * scope check — there is no longer a second answer to give, and the old
   * two-value mock sequence below was what made the difference visible.
   */
  it("throws NotFoundException — not Forbidden — when the actor has no project:read grant covering it", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    const err = await assertProjectVisible(tx, context(["project:read:department"], "d1"), "p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).not.toBeInstanceOf(ForbiddenException);
  });

  it("gives a hidden project and a missing one the identical answer", async () => {
    const answer = async (found: unknown) => {
      const tx = { project: { findFirst: jest.fn().mockResolvedValue(found) } } as unknown as PrismaTx;
      return assertProjectVisible(tx, context(["project:read:department"], "d1"), "p1").catch((e: { status?: number; message: string }) => ({
        status: e.status,
        message: e.message,
      }));
    };
    // Left: no such project. Right: it exists, but out of scope so the
    // scope-filtered lookup returns nothing. Same query, same empty result.
    expect(await answer(null)).toEqual(await answer(null));
    expect(await answer(null)).toMatchObject({ status: 404 });
  });

  it("passes when the project is within the actor's department scope", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) } } as unknown as PrismaTx;
    await expect(assertProjectVisible(tx, context(["project:read:department"], "d1"), "p1")).resolves.toBeUndefined();
  });
});

describe("documents.list", () => {
  it("throws when the project isn't visible", async () => {
    const tx = { project: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(documentsListDataSource.resolve({ projectId: "p1" }, context(["project:read:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });

  it("returns documents with resolved uploader names, applying the search filter", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: "u1", departmentId: null }) },
      document: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "d1", name: "Spec.pdf", mimeType: "application/pdf", sizeBytes: 100, version: 1, approvalStatus: null, uploadedById: "u1", createdAt: new Date(), updatedAt: new Date() }]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Alice" }]) },
    } as unknown as PrismaTx;

    const result = (await documentsListDataSource.resolve({ projectId: "p1", search: "spec" }, context(["project:read:tenant"]), tx)) as { uploadedByName: string }[];

    expect(result).toHaveLength(1);
    expect(result[0]!.uploadedByName).toBe("Alice");
    const findManyCall = (tx as unknown as { document: { findMany: jest.Mock } }).document.findMany.mock.calls[0][0];
    expect(findManyCall.where.name).toEqual({ contains: "spec", mode: "insensitive" });
  });
});

describe("document.detail", () => {
  it("throws NotFoundException when the document doesn't exist", async () => {
    const tx = { document: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaTx;
    await expect(documentDetailDataSource.resolve({ id: "d1" }, context(["project:read:tenant"]), tx)).rejects.toThrow(NotFoundException);
  });

  it("returns document + versions + activities with resolved names", async () => {
    const tx = {
      document: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "d1", projectId: "p1", name: "Spec.pdf", mimeType: "application/pdf", sizeBytes: 100, version: 2, approvalStatus: "approved", uploadedById: "u2", createdAt: new Date(), updatedAt: new Date() }),
      },
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: null, departmentId: null }) },
      documentVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "v1", version: 1, mimeType: "application/pdf", sizeBytes: 90, createdById: "u1", createdAt: new Date() }]),
      },
      documentActivity: {
        findMany: jest.fn().mockResolvedValue([{ id: "a1", type: "replaced", detail: "v1 -> v2", actorId: "u2", createdAt: new Date() }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "u1", displayName: "Alice" },
          { id: "u2", displayName: "Bob" },
        ]),
      },
    } as unknown as PrismaTx;

    const result = (await documentDetailDataSource.resolve({ id: "d1" }, context(["project:read:tenant"]), tx)) as {
      document: { uploadedByName: string };
      versions: { createdByName: string }[];
      activities: { actorName: string }[];
    };

    expect(result.document.uploadedByName).toBe("Bob");
    expect(result.versions[0]!.createdByName).toBe("Alice");
    expect(result.activities[0]!.actorName).toBe("Bob");
  });

  // Frontend Structural Redesign, Phase 1.
  it("computes canUpdate/canDelete from ctx.effective, not a hardcoded true", async () => {
    const tx = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: "d1", projectId: "p1", name: "Spec.pdf", mimeType: "application/pdf", sizeBytes: 100, version: 1, approvalStatus: null, uploadedById: "u1", createdAt: new Date(), updatedAt: new Date() }),
      },
      project: { findFirst: jest.fn().mockResolvedValue({ id: "p1", ownerId: null, departmentId: null }) },
      documentVersion: { findMany: jest.fn().mockResolvedValue([]) },
      documentActivity: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "u1", displayName: "Alice" }]) },
    } as unknown as PrismaTx;

    const readOnly = (await documentDetailDataSource.resolve({ id: "d1" }, context(["project:read:tenant"]), tx)) as { canUpdate: boolean; canDelete: boolean };
    expect(readOnly).toMatchObject({ canUpdate: false, canDelete: false });

    const full = (await documentDetailDataSource.resolve(
      { id: "d1" },
      context(["project:read:tenant", "document:update:tenant", "document:delete:tenant"]),
      tx,
    )) as { canUpdate: boolean; canDelete: boolean };
    expect(full).toMatchObject({ canUpdate: true, canDelete: true });
  });
});
