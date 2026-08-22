import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** No `isRowInScope` check here (unlike `requireClientInScope`/
 * `requireCourseInScope`) — deliberately: no role in this blueprint ever
 * holds `invoice:update:own`, only `:tenant` (Admin/Accountant/Billing
 * Clerk) — Sales Rep holds `invoice:read:own` but never `invoice:update` at
 * all. A plain existence+tenant check is the correct, complete guard;
 * `requiredPermission: "invoice:update"` alone already does the real work. */
async function requireInvoiceExists(tx: PrismaTx, ctx: MutationContext, invoiceId: string) {
  const existing = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No invoice "${invoiceId}"`);
  return existing;
}

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().int().nonnegative(), // cents
});

const CreateInputSchema = z.object({
  clientId: z.string(),
  issueDate: z.string(),
  dueDate: z.string(),
  lineItems: z.array(LineItemSchema).min(1),
  tax: z.number().int().nonnegative().optional(),
});

/** `subtotal`/`total` are always computed server-side from `lineItems`,
 * never trusted from the client — the one thing a real invoicing system
 * cannot let the caller simply assert. Starts life as `status: "draft"`;
 * `invoice.updateStatus` moves it to `sent`. */
export const invoiceCreateMutation: MutationDefinition<z.infer<typeof CreateInputSchema>> = {
  name: "invoice.create",
  inputSchema: CreateInputSchema,
  requiredPermission: "invoice:create",
  async resolve(input, ctx, tx) {
    const client = await tx.client.findFirst({ where: { id: input.clientId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!client) throw new NotFoundException(`No client "${input.clientId}"`);

    const lineItems = input.lineItems.map((li) => ({ ...li, amount: Math.round(li.quantity * li.unitPrice) }));
    const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
    const tax = input.tax ?? 0;

    const invoice = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        clientId: input.clientId,
        status: "draft",
        issueDate: new Date(input.issueDate),
        dueDate: new Date(input.dueDate),
        lineItems,
        subtotal,
        tax,
        total: subtotal + tax,
        createdById: ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "invoice", invoice.id); // AI RAG Phase C
    return invoice;
  },
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["void"],
  void: [],
};

const UpdateStatusInputSchema = z.object({ id: z.string(), status: z.enum(["draft", "sent", "void"]) });

/** Only forward workflow transitions are allowed (draft→sent/void,
 * sent→void) — never backward (e.g. sent→draft, or anything out of void),
 * a real invoicing-system invariant, not an arbitrary restriction. */
export const invoiceUpdateStatusMutation: MutationDefinition<z.infer<typeof UpdateStatusInputSchema>> = {
  name: "invoice.updateStatus",
  inputSchema: UpdateStatusInputSchema,
  requiredPermission: "invoice:update",
  async resolve(input, ctx, tx) {
    const existing = await requireInvoiceExists(tx, ctx, input.id);
    if (existing.status !== input.status && !VALID_TRANSITIONS[existing.status]?.includes(input.status)) {
      throw new BadRequestException(`Cannot move an invoice from "${existing.status}" to "${input.status}"`);
    }
    const updated = await tx.invoice.update({ where: { id: existing.id }, data: { status: input.status } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "invoice", updated.id); // AI RAG Phase C
    return updated;
  },
};
