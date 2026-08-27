import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { MutationContext, MutationDefinition } from "../../mutations/mutation-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { isRowInScope } from "../../rbac/scope-check";
import { contactsWhere } from "./crm.data-sources";
import { enqueueEmbeddingJob } from "../../ai/embeddings/embedding-ingestion";

/** Same `requireClientInScope` shape every module follows — flat own/tenant
 * scope, no department branch (Contact/Deal have no departmentId). */
async function requireContactInScope(tx: PrismaTx, ctx: MutationContext, contactId: string) {
  const existing = await tx.contact.findFirst({ where: { id: contactId, tenantId: ctx.tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundException(`No contact "${contactId}"`);
  const scope = ctx.effective.has("contact", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.ownerId }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this contact");
  return existing;
}

async function requireDealInScope(tx: PrismaTx, ctx: MutationContext, dealId: string) {
  const existing = await tx.deal.findFirst({ where: { id: dealId, tenantId: ctx.tenantId } });
  if (!existing) throw new NotFoundException(`No deal "${dealId}"`);
  const scope = ctx.effective.has("deal", "update");
  const inScope = scope && isRowInScope(scope, { ownerId: existing.ownerId }, { userId: ctx.userId });
  if (!inScope) throw new ForbiddenException("Not allowed to update this deal");
  return existing;
}

const ContactCreateInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  ownerId: z.string().optional(),
});

/** `ownerId` defaults to the creator — same "real, non-inert :own from day
 * one" precedent `client.create` established: a Sales Rep-equivalent role
 * creating their own contact becomes its owner immediately. */
export const contactCreateMutation: MutationDefinition<z.infer<typeof ContactCreateInputSchema>> = {
  name: "contact.create",
  inputSchema: ContactCreateInputSchema,
  requiredPermission: "contact:create",
  async resolve(input, ctx, tx) {
    if (input.ownerId) {
      const owner = await tx.user.findFirst({ where: { id: input.ownerId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!owner) throw new NotFoundException(`No user "${input.ownerId}"`);
    }
    const contact = await tx.contact.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        companyName: input.companyName,
        ownerId: input.ownerId ?? ctx.userId,
        createdById: ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "contact", contact.id); // AI RAG Phase C
    return contact;
  },
};

const ContactUpdateInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  ownerId: z.string().optional(),
});

export const contactUpdateMutation: MutationDefinition<z.infer<typeof ContactUpdateInputSchema>> = {
  name: "contact.update",
  inputSchema: ContactUpdateInputSchema,
  requiredPermission: "contact:update",
  async resolve(input, ctx, tx) {
    const existing = await requireContactInScope(tx, ctx, input.id);
    if (input.ownerId) {
      const owner = await tx.user.findFirst({ where: { id: input.ownerId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!owner) throw new NotFoundException(`No user "${input.ownerId}"`);
    }
    const updated = await tx.contact.update({
      where: { id: existing.id },
      data: { name: input.name, email: input.email, phone: input.phone, companyName: input.companyName, ownerId: input.ownerId },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "contact", updated.id); // AI RAG Phase C
    return updated;
  },
};

const DealCreateInputSchema = z.object({
  contactId: z.string(),
  title: z.string().min(1),
  valueCents: z.number().int().nonnegative().optional(),
  expectedCloseDate: z.coerce.date().optional(),
  ownerId: z.string().optional(),
});

/** The target contact must be visible to the creator (`contactsWhere`'s own
 * read-scope check, not the update check) — prevents creating deals against
 * a contact the actor otherwise can't see, a real data-leak the naive
 * "just check the contact exists in the tenant" version would allow. */
export const dealCreateMutation: MutationDefinition<z.infer<typeof DealCreateInputSchema>> = {
  name: "deal.create",
  inputSchema: DealCreateInputSchema,
  requiredPermission: "deal:create",
  async resolve(input, ctx, tx) {
    const contactWhere = await contactsWhere(tx, ctx, { id: input.contactId });
    const contact = contactWhere && (await tx.contact.findFirst({ where: contactWhere }));
    if (!contact) throw new NotFoundException(`No contact "${input.contactId}"`);

    if (input.ownerId) {
      const owner = await tx.user.findFirst({ where: { id: input.ownerId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!owner) throw new NotFoundException(`No user "${input.ownerId}"`);
    }

    const deal = await tx.deal.create({
      data: {
        tenantId: ctx.tenantId,
        contactId: input.contactId,
        title: input.title,
        valueCents: input.valueCents ?? 0,
        expectedCloseDate: input.expectedCloseDate,
        ownerId: input.ownerId ?? ctx.userId,
      },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "deal", deal.id); // AI RAG Phase C
    return deal;
  },
};

const DealUpdateInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).optional(),
  valueCents: z.number().int().nonnegative().optional(),
  expectedCloseDate: z.coerce.date().optional(),
  ownerId: z.string().optional(),
});

export const dealUpdateMutation: MutationDefinition<z.infer<typeof DealUpdateInputSchema>> = {
  name: "deal.update",
  inputSchema: DealUpdateInputSchema,
  requiredPermission: "deal:update",
  async resolve(input, ctx, tx) {
    const existing = await requireDealInScope(tx, ctx, input.id);
    if (input.ownerId) {
      const owner = await tx.user.findFirst({ where: { id: input.ownerId, tenantId: ctx.tenantId, deletedAt: null } });
      if (!owner) throw new NotFoundException(`No user "${input.ownerId}"`);
    }
    const updated = await tx.deal.update({
      where: { id: existing.id },
      data: { title: input.title, valueCents: input.valueCents, expectedCloseDate: input.expectedCloseDate, ownerId: input.ownerId },
    });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "deal", updated.id); // AI RAG Phase C
    return updated;
  },
};

const DealUpdateStageInputSchema = z.object({ id: z.string(), stage: z.string().min(1) });

/** Separate, lightweight mutation from `deal.update` — same `client.
 * updateStatus`/`task.updateStatus` precedent, and the specific shape
 * `KanbanBoard.tsx`'s own `updateMutation`/`updateValueKey` contract wants
 * (one mutation, one value field, `{id, [updateValueKey]: newColumn}`). */
export const dealUpdateStageMutation: MutationDefinition<z.infer<typeof DealUpdateStageInputSchema>> = {
  name: "deal.updateStage",
  inputSchema: DealUpdateStageInputSchema,
  requiredPermission: "deal:update",
  async resolve(input, ctx, tx) {
    const existing = await requireDealInScope(tx, ctx, input.id);
    const updated = await tx.deal.update({ where: { id: existing.id }, data: { stage: input.stage } });
    await enqueueEmbeddingJob(tx, ctx.tenantId, "deal", updated.id); // AI RAG Phase C
    return updated;
  },
};
