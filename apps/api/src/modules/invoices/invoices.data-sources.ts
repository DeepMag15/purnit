import { z } from "zod";
import { NotFoundException } from "@nestjs/common";
import type { DataSourceContext, DataSourceDefinition } from "../../data-sources/data-source-registry.service";
import type { PrismaTx } from "../../tenancy/tenant-prisma.service";
import { salesRepOwnedClientIds } from "../clients/clients.data-sources";

/** Same `*Where()` contract every module follows. `:own` resolves
 * transitively through Client via `salesRepOwnedClientIds` — a Sales Rep
 * sees only invoices for clients they personally own, never routed through
 * `clientsWhere` (see that function's own doc comment for why). */
export async function invoicesWhere(
  tx: PrismaTx,
  ctx: DataSourceContext,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const scope = ctx.effective.has("invoice", "read");
  if (!scope) return null;

  const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null, ...extra };
  if (scope === "tenant") return where;
  where.clientId = { in: await salesRepOwnedClientIds(tx, ctx) };
  return where;
}

/** "paid"/"overdue" are never stored (see invoice.prisma's own doc
 * comment) — always derived live from the sum of Payments against `total`
 * and `dueDate` against now. Computed the same way regardless of the
 * invoice's own workflow `status`, so a draft/void invoice simply reads
 * "unpaid" (the trivial, harmless case — no payment can exist against one,
 * enforced by `payment.record`'s own guard). */
export function computePaymentStatus(
  total: number,
  amountPaid: number,
  dueDate: Date,
  status: string,
): "unpaid" | "partial" | "paid" | "overdue" {
  if (amountPaid >= total && total > 0) return "paid";
  if (amountPaid > 0) return "partial";
  if (status === "sent" && dueDate.getTime() < Date.now()) return "overdue";
  return "unpaid";
}

async function withClientNames(tx: PrismaTx, invoices: { clientId: string }[]) {
  const clientIds = [...new Set(invoices.map((i) => i.clientId))];
  if (clientIds.length === 0) return new Map<string, string>();
  const clients = await tx.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } });
  return new Map(clients.map((c) => [c.id, c.name]));
}

/** Exported for reuse by invoices.metrics.ts (Finance Domain, Phase C) —
 * `invoicesOverdueCountMetric`/`invoicesTotalOutstandingMetric` both need
 * the same per-invoice paid-amount aggregate this list source already
 * computes, same "reuse the owning module's own already-scoped builder"
 * discipline `*Where()` functions already follow, extended here to a
 * shared aggregation helper too. */
export async function withAmountsPaid(tx: PrismaTx, tenantId: string, invoices: { id: string }[]) {
  if (invoices.length === 0) return new Map<string, number>();
  const grouped = await tx.payment.groupBy({
    by: ["invoiceId"],
    where: { tenantId, invoiceId: { in: invoices.map((i) => i.id) } },
    _sum: { amount: true },
  });
  return new Map(grouped.map((g) => [g.invoiceId, g._sum.amount ?? 0]));
}

const ListParamsSchema = z.object({ clientId: z.string().optional(), status: z.string().optional() });

export const invoicesListDataSource: DataSourceDefinition<z.infer<typeof ListParamsSchema>> = {
  name: "invoices.list",
  paramsSchema: ListParamsSchema,
  requiredPermission: "invoice:read",
  async resolve(params, ctx, tx) {
    const extra: Record<string, unknown> = {};
    if (params.clientId) extra.clientId = params.clientId;
    if (params.status) extra.status = params.status;
    const where = await invoicesWhere(tx, ctx, extra);
    if (!where) return [];
    const invoices = await tx.invoice.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });
    // Sequential, not Promise.all — concurrent queries against the same
    // transactional tx are unsafe.
    const clientNames = await withClientNames(tx, invoices);
    const amountsPaid = await withAmountsPaid(tx, ctx.tenantId, invoices);
    return invoices.map((inv) => {
      const amountPaid = amountsPaid.get(inv.id) ?? 0;
      return {
        id: inv.id,
        clientId: inv.clientId,
        clientName: clientNames.get(inv.clientId) ?? "Unknown",
        status: inv.status,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        total: inv.total,
        amountPaid,
        paymentStatus: computePaymentStatus(inv.total, amountPaid, inv.dueDate, inv.status),
      };
    });
  },
};

const DetailParamsSchema = z.object({ id: z.string() });

export const invoiceDetailDataSource: DataSourceDefinition<z.infer<typeof DetailParamsSchema>> = {
  name: "invoices.detail",
  paramsSchema: DetailParamsSchema,
  async resolve(params, ctx, tx) {
    const where = await invoicesWhere(tx, ctx, { id: params.id });
    if (!where) throw new NotFoundException(`No invoice "${params.id}"`);
    const invoice = await tx.invoice.findFirst({ where });
    if (!invoice) throw new NotFoundException(`No invoice "${params.id}"`);

    const clientNames = await withClientNames(tx, [invoice]);
    // Queried directly, not through payments.list's own permission gate —
    // the derived summary below is visible to anyone who can see the
    // invoice at all, same as course.detail's ungated assignmentCount.
    const paymentsAgg = await tx.payment.aggregate({ where: { tenantId: ctx.tenantId, invoiceId: invoice.id }, _sum: { amount: true } });
    const amountPaid = paymentsAgg._sum.amount ?? 0;

    const canUpdate = !!ctx.effective.has("invoice", "update");
    const canReadPayments = !!ctx.effective.has("payment", "read");
    const canRecordPayments = !!ctx.effective.has("payment", "create");

    return {
      ...invoice,
      clientName: clientNames.get(invoice.clientId) ?? "Unknown",
      amountPaid,
      paymentStatus: computePaymentStatus(invoice.total, amountPaid, invoice.dueDate, invoice.status),
      canUpdate,
      canReadPayments,
      canRecordPayments,
    };
  },
};

const InvoicesCapabilitiesParamsSchema = z.object({});

/** Frontend Redesign Phase 05 — `InvoicesWorkspace.tsx`'s move off the
 * generic Renderer loses the `actions` prop — both its own top-level
 * `canCreate` check, and the one it forwards, unchanged, into the nested
 * `KanbanBoard` primitive's own `actions?.some(mutation===updateMutation)`
 * gate for drag-to-update. `invoice.create`/`invoice.updateStatus` declare
 * genuinely different resources (`invoice:create`/`invoice:update`,
 * confirmed directly), so both get their own flag. No `requiredPermission`
 * of its own (callable by anyone), same precedent as `analytics.capabilities`. */
export const invoicesCapabilitiesDataSource: DataSourceDefinition<z.infer<typeof InvoicesCapabilitiesParamsSchema>> = {
  name: "invoices.capabilities",
  paramsSchema: InvoicesCapabilitiesParamsSchema,
  async resolve(_params, ctx) {
    return {
      canCreate: ctx.effective.has("invoice", "create") !== null,
      canUpdateStatus: ctx.effective.has("invoice", "update") !== null,
    };
  },
};
