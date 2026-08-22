import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

async function requirePurchaseOrderExists(tx: PrismaTx, ctx: MutationContext, purchaseOrderId: string) {
  const existing = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No purchase order "${purchaseOrderId}"`);
  return existing;
}

const LineItemSchema = z.object({
  inventoryItemId: z.string(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitCost: z.number().int().nonnegative(), // cents
});

const CreateInputSchema = z.object({
  supplierId: z.string(),
  expectedDate: z.string(),
  lineItems: z.array(LineItemSchema).min(1),
  tax: z.number().int().nonnegative().optional(),
});

/** `subtotal`/`total` are always computed server-side from `lineItems`,
 * never trusted from the client — same discipline `invoice.create` already
 * established. Starts life as `status: "draft"`; `purchaseOrder.updateStatus`
 * moves it to `submitted`. */
export const purchaseOrderCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "purchaseOrder.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "purchaseOrder:create",
  async resolve(input, ctx, tx) {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!supplier) throw new NotFoundException(`No supplier "${input.supplierId}"`);

    for (const li of input.lineItems) {
      const item = await tx.inventoryItem.findFirst({ where: { id: li.inventoryItemId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!item) throw new NotFoundException(`No inventory item "${li.inventoryItemId}"`);
    }

    const lineItems = input.lineItems.map((li) => ({ ...li, amount: Math.round(li.quantity * li.unitCost) }));
    const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
    const tax = input.tax ?? 0;

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        tenantId: ctx.tenantId,
        supplierId: input.supplierId,
        status: "draft",
        expectedDate: new Date(input.expectedDate),
        lineItems,
        subtotal,
        tax,
        total: subtotal + tax,
        createdById: ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "purchaseOrder", purchaseOrder.id); // AI RAG Phase C
    return purchaseOrder;
  },
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["cancelled"],
  received: [],
  cancelled: [],
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.enum(["draft", "submitted", "cancelled"]) });

/** Only forward paperwork transitions (draft→submitted/cancelled,
 * submitted→cancelled) — deliberately NEVER `→received`. Moving to
 * "received" is `purchaseOrder.receive`'s own job, gated on the distinct
 * `purchaseOrder:receive` permission — the actual procurement
 * segregation-of-duties control this domain is built around. */
export const purchaseOrderUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "purchaseOrder.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "purchaseOrder:update",
  async resolve(input, ctx, tx) {
    const existing = await requirePurchaseOrderExists(tx, ctx, input.id);
    if (existing.status !== input.status && !VALID_TRANSITIONS[existing.status]?.includes(input.status)) {
      throw new BadRequestException(`Cannot move a purchase order from "${existing.status}" to "${input.status}"`);
    }
    const updated = await tx.purchaseOrder.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "purchaseOrder", updated.id); // AI RAG Phase C
    return updated;
  },
};

const ReceiveInputSchema = z.object({ id: z.string() });

/** The procurement half of this domain's real segregation-of-duties
 * control: `purchaseOrder:receive` is held by Warehouse Staff/Admin only —
 * Procurement Officer holds `purchaseOrder:create/update` but zero
 * `purchaseOrder:receive`, so it can create and submit an order yet can
 * never be the one to confirm the goods arrived (`requiredPermission`
 * alone enforces this). Requires the order to be "submitted" — can't
 * receive a `draft` (not yet ordered) or already-`received`/`cancelled`
 * order. Increments each line item's `InventoryItem.currentStock`, the
 * real inventory-movement payoff of the whole procurement flow. */
export const purchaseOrderReceiveMutation: MutationDefinition<z.infer<typeof ReceiveInputSchema>> = {
  name: "purchaseOrder.receive",
  inputSchema: ReceiveInputSchema,
  requiredPermission: "purchaseOrder:receive",
  async resolve(input, ctx, tx) {
    const existing = await requirePurchaseOrderExists(tx, ctx, input.id);
    if (existing.status !== "submitted") {
      throw new BadRequestException(`Cannot receive a purchase order with status "${existing.status}"`);
    }

    const lineItems = existing.lineItems as { inventoryItemId: string; quantity: number }[];
    for (const li of lineItems) {
      await tx.inventoryItem.update({
        where: { id: li.inventoryItemId },
        data: { currentStock: { increment: Math.round(li.quantity) } },
      });
    }

    const updated = await tx.purchaseOrder.update({ where: { id: existing.id }, data: { status: "received" } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "purchaseOrder", updated.id); // AI RAG Phase C
    return updated;
  },
};
