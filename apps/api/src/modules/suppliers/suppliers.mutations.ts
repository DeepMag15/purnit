import { NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

async function requireSupplierExists(tx: PrismaTx, ctx: MutationContext, supplierId: string) {
  const existing = await tx.supplier.findFirst({ where: { id: supplierId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No supplier "${supplierId}"`);
  return existing;
}

const CreateInputSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
});

export const supplierCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "supplier.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "supplier:create",
  async resolve(input, ctx, tx) {
    const supplier = await tx.supplier.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        createdById: ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "supplier", supplier.id); // AI RAG Phase C
    return supplier;
  },
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.string().min(1) });

export const supplierUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "supplier.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "supplier:update",
  async resolve(input, ctx, tx) {
    const existing = await requireSupplierExists(tx, ctx, input.id);
    const updated = await tx.supplier.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "supplier", updated.id); // AI RAG Phase C
    return updated;
  },
};
