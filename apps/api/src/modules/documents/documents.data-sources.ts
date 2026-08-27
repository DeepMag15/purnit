import { NotFoundException } from "@nestjs/common";
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
  // Documents module review — one answer for both cases.
  //
  // This used to 404 a project that does not exist and 403 one the caller
  // cannot see, which let anyone tell the two apart by guessing ids. Every
  // detail source in this codebase deliberately refuses that distinction
  // (ARCHITECTURE.md §15.1, rule 2); Documents was the exception, and the
  // existence of a patient's chart or a student's submissions folder is
  // exactly the kind of thing it should not be leaking.
  const where = await projectsWhere(tx, ctx, { id: projectId });
  const inScope = where ? await tx.project.findFirst({ where, select: { id: true } }) : null;
  if (!inScope) throw new NotFoundException(`No project "${projectId}"`);
}

/**
 * Documents module review — who may do which half of an approval.
 *
 * Two flags, because they are two authorities (ARCHITECTURE.md §15.1, the
 * seventh rule). Before this the UI gated its approve/reject control on
 * `canUpdate`, which is neither: a Doctor holding document:update saw a
 * control that 403'd, and someone holding only document:approve saw no
 * control at all.
 *
 * Requesting is ownership — the person who uploaded the file is the person
 * who says it is ready. Deciding is a grant, and never the uploader's.
 */
function approvalFlags(ctx: DataSourceContext, uploadedById: string) {
  return {
    canRequestApproval: uploadedById === ctx.userId,
    canApprove: !!ctx.effective.has("document", "approve") && uploadedById !== ctx.userId,
  };
}

async function withUploaderNames(tx: PrismaTx, documents: { uploadedById: string }[]) {
  const uploaderIds = [...new Set(documents.map((d) => d.uploadedById))];
  if (uploaderIds.length === 0) return new Map<string, string>();
  const uploaders = await tx.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, displayName: true } });
  return new Map(uploaders.map((u) => [u.id, u.displayName]));
}

const ListParamsSchema = z.object({
  projectId: z.string(),
  search: z.string().optional(),
  /** Projects ecosystem review — narrow to the evidence for one task, so a
   * reviewer sees what that work produced rather than every file on the
   * project. Omitted means everything, exactly as before. */
  taskId: z.string().optional(),
});

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
        ...(params.taskId ? { taskId: params.taskId } : {}),
        ...(params.search ? { name: { contains: params.search, mode: "insensitive" as const } } : {}),
      },
      // Documents module review — the evidence link was writable and
      // unreadable: `taskId` has been filterable since the Projects review but
      // was never returned, so nothing could show which work produced a file.
      include: { task: { select: { title: true } } },
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
      taskId: d.taskId,
      taskTitle: d.task?.title ?? null,
      uploadedById: d.uploadedById,
      uploadedByName: uploaderNames.get(d.uploadedById) ?? "Unknown",
      ...approvalFlags(ctx, d.uploadedById),
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
    const document = await tx.document.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      include: { task: { select: { title: true } } },
    });
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
      ...approvalFlags(ctx, document.uploadedById),
      document: {
        id: document.id,
        projectId: document.projectId,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        version: document.version,
        approvalStatus: document.approvalStatus,
        taskId: document.taskId,
        taskTitle: document.task?.title ?? null,
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
