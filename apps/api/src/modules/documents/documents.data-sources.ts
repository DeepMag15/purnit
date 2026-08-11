import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { projectsWhere } from "../projects/projects.data-sources";

/** A document's visibility is purely "can the actor see its parent
 * project" — no separate document:read permission exists (ORG_HIERARCHY.md
 * §12: default to the org graph rather than a hard permission gate).
 * Mirrors `assertCommentTargetInScope`'s existing "project" branch exactly
 * (comments.mutations.ts) — reimplemented locally rather than imported, to
 * avoid a circular import (comments.mutations.ts's own new "document"
 * branch needs to check the *same* thing in the other direction). */
export async function assertProjectVisible(tx: PrismaTx, ctx: DataSourceContext, projectId: string): Promise<void> {
  const existing = await tx.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No project "${projectId}"`);
  const where = await projectsWhere(tx, ctx, { id: projectId });
  const inScope = where ? await tx.project.findFirst({ where }) : null;
  if (!inScope) throw new ForbiddenException("Not allowed to view this project's documents");
}

async function withUploaderNames(tx: PrismaTx, documents: { uploadedById: string }[]) {
  const uploaderIds = [...new Set(documents.map((d) => d.uploadedById))];
  if (uploaderIds.length === 0) return new Map<string, string>();
  const uploaders = await tx.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, displayName: true } });
  return new Map(uploaders.map((u) => [u.id, u.displayName]));
}

const ListParamsSchema = z.object({ projectId: z.string(), search: z.string().optional() });

// No requiredPermission — see assertProjectVisible's doc comment.
export const documentsListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "documents.list",
  paramsSchema: ListParamsSchema,
  async resolve(params, ctx, tx) {
    await assertProjectVisible(tx, ctx, params.projectId);

    const documents = await tx.document.findMany({
      where: {
        tenantId: ctx.tenantId,
        projectId: params.projectId,
        deletedAt: null,
        ...(params.search ? { name: { contains: params.search, mode: "insensitive" as const } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const uploaderNames = await withUploaderNames(tx, documents);

    return documents.map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      version: d.version,
      approvalStatus: d.approvalStatus,
      uploadedById: d.uploadedById,
      uploadedByName: uploaderNames.get(d.uploadedById) ?? "Unknown",
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

// No requiredPermission — same visibility-only gate as documents.list.
export const documentDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "document.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const document = await tx.document.findFirst({ where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null } });
    if (!document) throw new NotFoundException(`No document "${params.id}"`);
    await assertProjectVisible(tx, ctx, document.projectId);

    // Sequential — same shared-tx rule as every other multi-query resolver.
    const versions = await tx.documentVersion.findMany({ where: { documentId: document.id }, orderBy: { version: "desc" } });
    const activities = await tx.documentActivity.findMany({ where: { documentId: document.id }, orderBy: { createdAt: "desc" } });

    const actorIds = [...new Set([document.uploadedById, ...versions.map((v) => v.createdById), ...activities.map((a) => a.actorId)])];
    const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
    const nameById = new Map(actors.map((a) => [a.id, a.displayName]));

    // Frontend Structural Redesign, Phase 1 — same computed-capability-flag
    // precedent project.detail/task.detail already established (Phase 0): a
    // hand-written detail-page route has no pruned `actions` array to read
    // capability from the way DocumentsPanel (a blueprint-driven composite)
    // does.
    const canUpdate = !!ctx.effective.has("document", "update");
    const canDelete = !!ctx.effective.has("document", "delete");

    return {
      canUpdate,
      canDelete,
      document: {
        id: document.id,
        projectId: document.projectId,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        version: document.version,
        approvalStatus: document.approvalStatus,
        uploadedById: document.uploadedById,
        uploadedByName: nameById.get(document.uploadedById) ?? "Unknown",
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      },
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        createdById: v.createdById,
        createdByName: nameById.get(v.createdById) ?? "Unknown",
        createdAt: v.createdAt,
      })),
      activities: activities.map((a) => ({
        id: a.id,
        type: a.type,
        detail: a.detail,
        actorId: a.actorId,
        actorName: nameById.get(a.actorId) ?? "Unknown",
        createdAt: a.createdAt,
      })),
    };
  },
};
