import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import type { SupabaseAdminService } from "../../auth/supabase-admin.service";
import { isRowInScope } from "../../rbac/scope-check";
import { getDepartmentSubtreeIds } from "../../rbac/department-subtree";
import { assertProjectVisible } from "./documents.data-sources";
import { enqueueDocumentEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

// Defense-in-depth alongside the "documents" bucket's own server-side
// allowedMimeTypes/fileSizeLimit config — this check runs first, before any
// Storage credential is minted, so a rejected upload never even reaches
// Storage.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

function assertFileAllowed(mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new BadRequestException(`File type "${mimeType}" is not allowed`);
  if (sizeBytes > MAX_SIZE_BYTES) throw new BadRequestException("File exceeds the 25MB size limit");
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1) : "bin";
}

function buildDocumentStoragePath(tenantId: string, projectId: string, fileName: string): string {
  return `${tenantId}/${projectId}/${randomUUID()}.${extensionOf(fileName)}`;
}

/** Validates a *target* project (no existing Document row yet) is within
 * the actor's document:create scope — checked against the project's own
 * `{ownerId, departmentId}`, same shape as `requireDocumentInScope` below,
 * but for creation rather than an existing row. Deliberately stricter than
 * `task.create`'s existing precedent, which accepts any `projectId` with no
 * scope validation at all — see the plan's documented reasoning. */
async function assertCanCreateInProject(tx: PrismaTx, ctx: MutationContext, projectId: string) {
  const project = await tx.project.findFirst({ where: { id: projectId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!project) throw new NotFoundException(`No project "${projectId}"`);

  const scope = ctx.effective.has("document", "create");
  if (!scope) throw new ForbiddenException('Missing permission "document:create"');
  const departmentSubtreeIds =
    scope === "department-subtree" && ctx.userDepartmentId ? await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
  const inScope = isRowInScope(
    scope,
    { ownerId: project.ownerId, departmentId: project.departmentId },
    { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
  );
  if (!inScope) throw new ForbiddenException("Not allowed to upload documents to this project");
  return project;
}

/** Validates an *existing* Document row is within the actor's
 * document:update/delete scope — fetches the row plus its parent Project's
 * `{ownerId, departmentId}` in one query, exact same shape as
 * `requireTaskInScope` (tasks.mutations.ts). */
async function requireDocumentInScope(tx: PrismaTx, ctx: MutationContext, documentId: string, action: "update" | "delete") {
  const existing = await tx.document.findFirst({
    where: { id: documentId, tenantId: ctx.tenantId, deletedAt: null },
    include: { project: { select: { id: true, ownerId: true, departmentId: true } } },
  });
  if (!existing) throw new NotFoundException(`No document "${documentId}"`);

  const scope = ctx.effective.has("document", action);
  const departmentSubtreeIds =
    scope === "department-subtree" && ctx.userDepartmentId ? await getDepartmentSubtreeIds(tx, ctx.tenantId, ctx.userDepartmentId) : undefined;
  const inScope =
    scope &&
    isRowInScope(
      scope,
      { ownerId: existing.project.ownerId, departmentId: existing.project.departmentId },
      { userId: ctx.userId, departmentId: ctx.userDepartmentId, departmentSubtreeIds },
    );
  if (!inScope) throw new ForbiddenException(`Not allowed to ${action} this document`);

  return existing;
}

async function logActivity(tx: PrismaTx, tenantId: string, documentId: string, actorId: string, type: string, detail?: string) {
  await tx.documentActivity.create({ data: { tenantId, documentId, actorId, type, detail } });
}

// --- Upload (new document) ---

const CreateUploadUrlInputSchema = z.object({
  projectId: z.string(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

/** Factory (needs `SupabaseAdminService`) — mints a signed upload URL, never
 * touches `tx` beyond the scope-check read. Mirrors
 * `createCreateLogoUploadUrlMutation`'s "no external I/O inside the DB
 * transaction" shape exactly. */
export function createDocumentCreateUploadUrlMutation(
  supabaseAdmin: SupabaseAdminService,
): MutationDefinition<z.infer<typeof CreateUploadUrlInputSchema>> {
  return {
    name: "document.createUploadUrl",
    inputSchema: CreateUploadUrlInputSchema,
    requiredPermission: "document:create",
    async resolve(input, ctx, tx) {
      await assertCanCreateInProject(tx, ctx, input.projectId);
      assertFileAllowed(input.mimeType, input.sizeBytes);

      const path = buildDocumentStoragePath(ctx.tenantId, input.projectId, input.fileName);
      const { signedUrl, token } = await supabaseAdmin.createDocumentSignedUploadUrl(path);
      return { path, signedUrl, token };
    },
  };
}

const CreateInputSchema = z.object({
  projectId: z.string(),
  storagePath: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const documentCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "document.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "document:create",
  async resolve(input, ctx, tx) {
    await assertCanCreateInProject(tx, ctx, input.projectId);
    assertFileAllowed(input.mimeType, input.sizeBytes);

    const document = await tx.document.create({
      data: {
        tenantId: ctx.tenantId,
        projectId: input.projectId,
        name: input.name,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedById: ctx.userId,
      },
    });
    await logActivity(tx, ctx.tenantId, document.id, ctx.userId, "uploaded");
    await enqueueDocumentEmbeddingJob(tx, ctx.tenantId, document.id, document.mimeType);
    return document;
  },
};

// --- Rename ---

const UpdateInputSchema = z.object({ id: z.string(), name: z.string().min(1) });

export const documentUpdateMutation: MutationDefinition<z.infer<typeof UpdateInputSchema>> = {
  name: "document.update",
  inputSchema: UpdateInputSchema,
  requiredPermission: "document:update",
  async resolve(input, ctx, tx) {
    const existing = await requireDocumentInScope(tx, ctx, input.id, "update");
    const updated = await tx.document.update({ where: { id: input.id }, data: { name: input.name } });
    if (existing.name !== input.name) {
      await logActivity(tx, ctx.tenantId, input.id, ctx.userId, "renamed", `"${existing.name}" -> "${input.name}"`);
    }
    return updated;
  },
};

// --- Replace (new version) ---

const CreateReplaceUploadUrlInputSchema = z.object({
  id: z.string(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export function createDocumentCreateReplaceUploadUrlMutation(
  supabaseAdmin: SupabaseAdminService,
): MutationDefinition<z.infer<typeof CreateReplaceUploadUrlInputSchema>> {
  return {
    name: "document.createReplaceUploadUrl",
    inputSchema: CreateReplaceUploadUrlInputSchema,
    requiredPermission: "document:update",
    async resolve(input, ctx, tx) {
      await requireDocumentInScope(tx, ctx, input.id, "update");
      assertFileAllowed(input.mimeType, input.sizeBytes);

      // A fresh path, never the existing one — the old Storage object must
      // survive so DocumentVersion's snapshot stays downloadable after the
      // replace finalizes.
      const existing = await tx.document.findFirst({ where: { id: input.id }, select: { projectId: true } });
      const path = buildDocumentStoragePath(ctx.tenantId, existing!.projectId, input.fileName);
      const { signedUrl, token } = await supabaseAdmin.createDocumentSignedUploadUrl(path);
      return { path, signedUrl, token };
    },
  };
}

const FinalizeReplaceInputSchema = z.object({
  id: z.string(),
  storagePath: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const documentFinalizeReplaceMutation: MutationDefinition<z.infer<typeof FinalizeReplaceInputSchema>> = {
  name: "document.finalizeReplace",
  inputSchema: FinalizeReplaceInputSchema,
  requiredPermission: "document:update",
  async resolve(input, ctx, tx) {
    const existing = await requireDocumentInScope(tx, ctx, input.id, "update");

    // Snapshot the pre-replace state — the version that's about to stop
    // being current — before overwriting it.
    await tx.documentVersion.create({
      data: {
        tenantId: ctx.tenantId,
        documentId: existing.id,
        version: existing.version,
        storagePath: existing.storagePath,
        mimeType: existing.mimeType,
        sizeBytes: existing.sizeBytes,
        createdById: existing.uploadedById,
      },
    });

    const updated = await tx.document.update({
      where: { id: input.id },
      data: {
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        version: existing.version + 1,
        uploadedById: ctx.userId,
      },
    });
    await logActivity(tx, ctx.tenantId, input.id, ctx.userId, "replaced", `v${existing.version} -> v${existing.version + 1}`);
    await enqueueDocumentEmbeddingJob(tx, ctx.tenantId, updated.id, updated.mimeType);
    return updated;
  },
};

// --- Approval status ---

const SetApprovalStatusInputSchema = z.object({ id: z.string(), status: z.enum(["pending", "approved", "rejected"]) });

export const documentSetApprovalStatusMutation: MutationDefinition<z.infer<typeof SetApprovalStatusInputSchema>> = {
  name: "document.setApprovalStatus",
  inputSchema: SetApprovalStatusInputSchema,
  // Reuses document:update rather than a dedicated document:approve triple
  // — a deliberate lightweight choice (see the plan's flagged judgment
  // call); revisit if dedicated approver roles are ever wanted.
  requiredPermission: "document:update",
  async resolve(input, ctx, tx) {
    await requireDocumentInScope(tx, ctx, input.id, "update");
    const updated = await tx.document.update({ where: { id: input.id }, data: { approvalStatus: input.status } });
    await logActivity(tx, ctx.tenantId, input.id, ctx.userId, "approval_status_changed", input.status);
    return updated;
  },
};

// --- Delete ---

const DeleteInputSchema = z.object({ id: z.string() });

export const documentDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "document.delete",
  inputSchema: DeleteInputSchema,
  requiredPermission: "document:delete",
  async resolve(input, ctx, tx) {
    await requireDocumentInScope(tx, ctx, input.id, "delete");
    const updated = await tx.document.update({ where: { id: input.id }, data: { deletedAt: new Date() } });
    await logActivity(tx, ctx.tenantId, input.id, ctx.userId, "deleted");
    return updated;
  },
};

// --- View / download ---

const GetFileUrlInputSchema = z.object({ id: z.string(), mode: z.enum(["view", "download"]), versionId: z.string().optional() });

/** Factory (needs `SupabaseAdminService`), no `requiredPermission` —
 * visibility-only, exact mirror of `meeting.getJoinInfo`'s "mint a scoped,
 * time-limited credential only after confirming authorization" shape. */
export function createDocumentGetFileUrlMutation(supabaseAdmin: SupabaseAdminService): MutationDefinition<z.infer<typeof GetFileUrlInputSchema>> {
  return {
    name: "document.getFileUrl",
    inputSchema: GetFileUrlInputSchema,
    async resolve(input, ctx, tx) {
      const document = await tx.document.findFirst({ where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null } });
      if (!document) throw new NotFoundException(`No document "${input.id}"`);
      await assertProjectVisible(tx, ctx, document.projectId);

      let storagePath = document.storagePath;
      let mimeType = document.mimeType;
      if (input.versionId) {
        const version = await tx.documentVersion.findFirst({ where: { id: input.versionId, documentId: document.id } });
        if (!version) throw new NotFoundException(`No version "${input.versionId}" for this document`);
        storagePath = version.storagePath;
        mimeType = version.mimeType;
      }

      const signedUrl = await supabaseAdmin.createDocumentSignedUrl(storagePath, input.mode === "download" ? document.name : undefined);
      return { signedUrl, mimeType, name: document.name };
    },
  };
}
