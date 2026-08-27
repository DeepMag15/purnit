import { BadRequestException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationDefinition } from "../../mutations/mutation-registry.service";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

const RecordInputSchema = z.object({
  invoiceId: z.string(),
  amount: z.number().int().positive(), // cents
  method: z.string().min(1),
  paidAt: z.string().optional(),
  notes: z.string().optional(),
});

/** The separation-of-duties gate for this whole domain: `payment:create` is
 * held by Admin/Accountant only — Billing Clerk holds `invoice:create/update`
 * but zero `payment:*`, so it can issue and manage an invoice yet can never
 * be the one to mark it paid (`requiredPermission` alone enforces this; no
 * extra check needed here beyond it). Requires the invoice to be `"sent"` —
 * can't record a payment against a `draft` (not yet issued) or `void`
 * (cancelled) invoice. Append-only: no `payment.update`/`payment.delete`
 * mutation exists at all (see payment.prisma's own doc comment) — a
 * correction is a new, possibly negative, payment row. */
export const paymentRecordMutation: MutationDefinition<z.infer<typeof RecordInputSchema>> = {
  name: "payment.record",
  inputSchema: RecordInputSchema,
  requiredPermission: "payment:create",
  async resolve(input, ctx, tx) {
    const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, tenantId: ctx.tenantId, deletedAt: null } });
    if (!invoice) throw new NotFoundException(`No invoice "${input.invoiceId}"`);
    if (invoice.status !== "sent") {
      throw new BadRequestException(`Cannot record a payment against an invoice with status "${invoice.status}"`);
    }

    const payment = await tx.payment.create({
      data: {
        tenantId: ctx.tenantId,
        invoiceId: input.invoiceId,
        amount: input.amount,
        method: input.method,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        recordedById: ctx.userId,
        notes: input.notes,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "payment", payment.id); // AI RAG Phase C
    return payment;
  },
};
