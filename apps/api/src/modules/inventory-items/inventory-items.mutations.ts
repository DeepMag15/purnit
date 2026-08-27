import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

async function requireInventoryItemExists(tx: PrismaTx, ctx: MutationContext, itemId: string) {
  const existing = await tx.inventoryItem.findFirst({ where: { id: itemId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No inventory item "${itemId}"`);
  return existing;
}

const CreateInputSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  unitOfMeasure: z.string().min(1),
  unitCost: z.number().int().nonnegative().optional(), // cents
  reorderPoint: z.number().int().nonnegative().optional(),
});

/** Creates the InventoryItem row and its backing "files" Project in one
 * transaction — verbatim structural mirror of `client.create`/`course`'s own
 * materials-Project creation. `currentStock` always starts at 0 — stock only
 * ever enters via `purchaseOrder.receive`/`workOrder.complete`, never at
 * creation time. */
export const inventoryItemCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "inventoryItem.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "inventoryItem:create",
  async resolve(input, ctx, tx) {
    const existingSku = await tx.inventoryItem.findFirst({ where: { tenantId: ctx.tenantId, sku: input.sku, deletedAt: null } });
    if (existingSku) throw new BadRequestException(`SKU "${input.sku}" is already in use`);

    const filesProject = await tx.project.create({
      data: { tenantId: ctx.tenantId, name: `Files: ${input.name}`, status: "active", ownerId: ctx.userId, kind: "itemFiles" },
    });

    const item = await tx.inventoryItem.create({
      data: {
        tenantId: ctx.tenantId,
        filesProjectId: filesProject.id,
        sku: input.sku,
        name: input.name,
        type: input.type,
        unitOfMeasure: input.unitOfMeasure,
        unitCost: input.unitCost ?? 0,
        reorderPoint: input.reorderPoint ?? 0,
        createdById: ctx.userId,
      },
    });

    await tx.projectMember.create({ data: { tenantId: ctx.tenantId, projectId: filesProject.id, userId: ctx.userId } });

    await enqueueEmbeddingJob(tx, ctx.tenantId, "inventoryItem", item.id); // AI RAG Phase C
    return item;
  },
};

const UpdateInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  unitCost: z.number().int().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  status: z.string().min(1).optional(),
});

export const inventoryItemUpdateMutation: MutationDefinition<z.infer<typeof UpdateInputSchema>> = {
  name: "inventoryItem.update",
  inputSchema: UpdateInputSchema,
  requiredPermission: "inventoryItem:update",
  async resolve(input, ctx, tx) {
    const existing = await requireInventoryItemExists(tx, ctx, input.id);
    const updated = await tx.inventoryItem.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unitCost !== undefined ? { unitCost: input.unitCost } : {}),
        ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "inventoryItem", updated.id); // AI RAG Phase C
    return updated;
  },
};

const AdjustStockInputSchema = z.object({ id: z.string(), delta: z.number().int(), reason: z.string().min(1) });

/** A manual correction (stock count, damage, shrinkage) — the only mutation
 * besides `purchaseOrder.receive`/`workOrder.complete` allowed to move
 * `currentStock`. Deliberately gated on the same `inventoryItem:update`
 * permission as master-data edits (a disclosed Phase A simplification,
 * see the domain's own doc comment on `InventoryItem.currentStock`) —
 * Warehouse Staff holds it for exactly this reason. */
export const inventoryItemAdjustStockMutation: MutationDefinition<z.infer<typeof AdjustStockInputSchema>> = {
  name: "inventoryItem.adjustStock",
  inputSchema: AdjustStockInputSchema,
  requiredPermission: "inventoryItem:update",
  async resolve(input, ctx, tx) {
    const existing = await requireInventoryItemExists(tx, ctx, input.id);
    const newStock = existing.currentStock + input.delta;
    if (newStock < 0) {
      throw new BadRequestException(`Adjustment would take "${existing.name}" stock below zero (currently ${existing.currentStock})`);
    }
    return tx.inventoryItem.update({ where: { id: existing.id }, data: { currentStock: newStock } });
  },
};
