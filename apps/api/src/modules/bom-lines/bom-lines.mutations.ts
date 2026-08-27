import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

async function requireBomLineExists(tx: PrismaTx, ctx: MutationContext, bomLineId: string) {
  const existing = await tx.bOMLine.findFirst({ where: { id: bomLineId, tenantId: ctx.tenantId } });
  if (!existing) throw new NotFoundException(`No BOM line "${bomLineId}"`);
  return existing;
}

const CreateInputSchema = z.object({
  parentItemId: z.string(),
  componentItemId: z.string(),
  quantityRequired: z.number().int().positive(),
});

/** `parentItemId === componentItemId` is rejected here, in application code
 * — matches this codebase's existing "enforce invariants in the mutation,
 * not a DB CHECK" discipline (see `invoice.updateStatus`'s
 * VALID_TRANSITIONS). Deeper multi-level cycle detection (A needs B needs A
 * transitively) is a disclosed Phase A simplification, not attempted here. */
export const bomLineCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "bomLine.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "bomLine:create",
  async resolve(input, ctx, tx) {
    if (input.parentItemId === input.componentItemId) {
      throw new BadRequestException("An item cannot be a component of itself");
    }
    const parent = await tx.inventoryItem.findFirst({ where: { id: input.parentItemId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!parent) throw new NotFoundException(`No inventory item "${input.parentItemId}"`);
    const component = await tx.inventoryItem.findFirst({ where: { id: input.componentItemId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!component) throw new NotFoundException(`No inventory item "${input.componentItemId}"`);

    const existingLine = await tx.bOMLine.findFirst({
      where: { tenantId: ctx.tenantId, parentItemId: input.parentItemId, componentItemId: input.componentItemId },
    });
    if (existingLine) throw new BadRequestException("This component is already on the bill of materials");

    const bomLine = await tx.bOMLine.create({
      data: {
        tenantId: ctx.tenantId,
        parentItemId: input.parentItemId,
        componentItemId: input.componentItemId,
        quantityRequired: input.quantityRequired,
        createdById: ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "bomLine", bomLine.id); // AI RAG Phase C
    return bomLine;
  },
};

const UpdateInputSchema = z.object({ id: z.string(), quantityRequired: z.number().int().positive() });

export const bomLineUpdateMutation: MutationDefinition<z.infer<typeof UpdateInputSchema>> = {
  name: "bomLine.update",
  inputSchema: UpdateInputSchema,
  requiredPermission: "bomLine:update",
  async resolve(input, ctx, tx) {
    const existing = await requireBomLineExists(tx, ctx, input.id);
    const updated = await tx.bOMLine.update({ where: { id: existing.id }, data: { quantityRequired: input.quantityRequired } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "bomLine", updated.id); // AI RAG Phase C
    return updated;
  },
};

const DeleteInputSchema = z.object({ id: z.string() });

export const bomLineDeleteMutation: MutationDefinition<z.infer<typeof DeleteInputSchema>> = {
  name: "bomLine.delete",
  inputSchema: DeleteInputSchema,
  requiredPermission: "bomLine:delete",
  async resolve(input, ctx, tx) {
    const existing = await requireBomLineExists(tx, ctx, input.id);
    await tx.bOMLine.delete({ where: { id: existing.id } });
    return { id: existing.id };
  },
};
