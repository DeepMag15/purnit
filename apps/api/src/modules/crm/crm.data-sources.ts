import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";

/** Same `clientsWhere` contract every module follows. `:own` resolves to
 * `ownerId = ctx.userId` — flat own/tenant scope, no department branch, same
 * shape as Client (Contact/Deal have no departmentId — ownership is
 * individual, not org-chart-based). */
export async function contactsWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("contact", "read");
  if (!scope) return null;
  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.ownerId = ctx.userId;
  return where;
}

export async function dealsWhere(tx: PrismaTx, ctx: DataSourceContext, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("deal", "read");
  if (!scope) return null;
  const where: Record<string, unknown> = { tenantId: ctx.tenantId, ...extra };
  if (scope === "tenant") return where;
  where.ownerId = ctx.userId;
  return where;
}

async function withOwnerNames(tx: PrismaTx, rows: { ownerId: string | null }[]) {
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((id): id is string => !!id))];
  if (ownerIds.length === 0) return new Map<string, string>();
  const owners = await tx.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true } });
  return new Map(owners.map((o) => [o.id, o.displayName]));
}

const ContactsListParamsSchema = z.object({});

export const contactsListDataSource: DataSourceDefinition<z.infer<typeof ContactsListParamsSchema>> = {
  name: "contacts.list",
  paramsSchema: ContactsListParamsSchema,
  requiredPermission: "contact:read",
  async resolve(_params, ctx, tx) {
    const where = await contactsWhere(tx, ctx);
    if (!where) return [];
    const contacts = await tx.contact.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    const ownerNames = await withOwnerNames(tx, contacts);
    const dealCounts = await tx.deal.groupBy({
      by: ["contactId"],
      where: { tenantId: ctx.tenantId, contactId: { in: contacts.map((c) => c.id) } },
      _count: { contactId: true },
    });
    const dealCountByContact = new Map(dealCounts.map((d) => [d.contactId, d._count.contactId]));
    return contacts.map((c) => ({
      ...c,
      ownerName: c.ownerId ? (ownerNames.get(c.ownerId) ?? null) : null,
      dealCount: dealCountByContact.get(c.id) ?? 0,
    }));
  },
};

const ContactDetailParamsSchema = z.object({ id: z.string() });

export const contactDetailDataSource: DataSourceDefinition<z.infer<typeof ContactDetailParamsSchema>> = {
  name: "contact.detail",
  paramsSchema: ContactDetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await contactsWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No contact "${params.id}"`);
    const contact = await tx.contact.findFirst({ where });
    if (!contact) throw new NotFoundException(`No contact "${params.id}"`);

    const ownerNames = await withOwnerNames(tx, [contact]);
    const deals = await tx.deal.findMany({ where: { tenantId: ctx.tenantId, contactId: contact.id }, orderBy: { createdAt: "desc" } });

    return {
      ...contact,
      ownerName: contact.ownerId ? (ownerNames.get(contact.ownerId) ?? null) : null,
      canUpdate: !!ctx.effective.has("contact", "update"),
      canCreateDeals: !!ctx.effective.has("deal", "create"),
      deals,
    };
  },
};

const DealsListParamsSchema = z.object({ contactId: z.string().optional() });

export const dealsListDataSource: DataSourceDefinition<z.infer<typeof DealsListParamsSchema>> = {
  name: "deals.list",
  paramsSchema: DealsListParamsSchema,
  requiredPermission: "deal:read",
  async resolve(params, ctx, tx) {
    const where = await dealsWhere(tx, ctx, params.contactId ? { contactId: params.contactId } : {});
    if (!where) return [];
    const deals = await tx.deal.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    const contactIds = [...new Set(deals.map((d) => d.contactId))];
    const contacts = await tx.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } });
    const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));
    return deals.map((d) => ({ ...d, contactName: contactNameById.get(d.contactId) ?? "Unknown" }));
  },
};

const CapabilitiesParamsSchema = z.object({});

/** Same `project.detail`-style precedent as every other `*.capabilities`
 * source this session. Gates the "New Contact"/"New Deal" buttons and the
 * Deals Kanban board's drag permission on the real granted permission,
 * never a role-label guess. */
export const crmCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof CapabilitiesParamsSchema>> = {
  name: "crm.capabilities",
  paramsSchema: CapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreateContact: !!ctx.effective.has("contact", "create"),
      canCreateDeal: !!ctx.effective.has("deal", "create"),
      canUpdateDeal: !!ctx.effective.has("deal", "update"),
    };
  },
};
